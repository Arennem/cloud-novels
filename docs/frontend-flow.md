# 前端流程图文档

> 面向前端开发者的用户操作流程指南。描述用户在页面上的完整操作路径、组件划分、数据流转和所有接口调用时序。

---

## 1. 关键约定

### ID 传递方式

**所有接口都不使用路径参数（`/:novelId` 风格）**，ID 统一通过以下方式传递：

| 方法 | 传参方式 | 示例 |
|---|---|---|
| GET | query string | `GET /novel?id=xxx` |
| POST (删除) | JSON body | `POST /novel/delete` body `{ "id": "xxx" }` |
| GET (列表过滤) | query string | `GET /characters?novel_id=xxx` |
| GET (按标题查) | query string | `GET /novel/chapters?novel_title=星辰大海` |
| GET (路径参数) | URL path | `GET /task/:id` **（唯一例外）** |

### API Base URL & 静态资源

```text
http://localhost:3000
```

**静态音频文件访问**：章节音频和合并音频以相对 URL 返回，需拼接 base：

```typescript
const audioUrl = `http://localhost:3000${chapter.url}`;
```

### 响应信封

所有响应（除 `POST /tts` 返回裸二进制流外）都使用统一 JSON 信封：

```typescript
interface ApiResponse<T> {
  status: number;           // 0=成功，非0=错误码
  data: T | null;           // 业务数据
  errorMsg: string | null;  // 失败时的错误信息
  timestamp: string;        // "2025-07-08 14:30:00"
  traceId: string;          // UUID
}
```

前端调用时需先解信封：

```typescript
const envelope = await res.json();
if (envelope.status !== 0) throw new Error(envelope.errorMsg);
const data = envelope.data;
```

### 分页格式

所有列表返回统一使用分页结构：

```typescript
interface PaginatedList<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  list: T[];
}

// 取值方式
const characters = data.characters.list; // CharacterPortrait[]
```

---

## 2. 核心架构变更：异步合成任务

**关键变更**：`POST /novel/convert` 和 `POST /novel/synthesize` 都已改为**异步任务模式**。

- 提交任务后立即返回 `{ task_id, task_status: "pending", novel_id }`
- 后台通过 `setImmediate` 异步处理：角色分析 → 注册声音 → 逐章标注 → 逐句合成 → 章节合并
- 前端需**轮询** `GET /task/:id` 获取进度，直到任务完成

### 任务状态机

```
Task 状态：pending → processing → completed | partial | failed

Chapter 子任务状态：pending → annotating → synthesizing → merging → completed
                     → failed (任意阶段出错)
                     → cached (缓存命中，跳过合成)
```

### 前端轮询策略

```typescript
async function pollTask(taskId: string, onProgress: (task: TaskDetail) => void): Promise<TaskDetail> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const task = await getTaskDetail(taskId);
        onProgress(task);
        if (['completed', 'partial', 'failed'].includes(task.status)) {
          clearInterval(interval);
          resolve(task);
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, 2000);
  });
}
```

---

## 3. 完整页面与接口对照

以下是完整的后端接口清单，前端每个页面依此调用：

| 方法 | 路径 | 传参 | 页面 | 说明 |
|------|------|------|------|------|
| POST | /novel/upload | JSON body 或 multipart | 上传页 | 上传文本，自动解析章节 |
| POST | /novel/analyze | JSON body | 上传页 | 立即分析角色画像（非异步） |
| POST | /novel/convert | JSON body | 角色编辑页 | **异步任务**：完整合成管线 |
| POST | /novel/synthesize | JSON body | 结果页/详情页 | **异步任务**：按需合成章节 |
| GET | /task/:id | 路径参数 `:id` | 结果页 | 轮询任务进度和结果 |
| GET | /tasks | `?novel_id=xxx` | 结果页/详情页 | 查看小说所有任务 |
| POST | /tts | JSON body | 角色编辑页 | 单段试听（返回裸音频） |
| GET | /novels | — | 首页/列表页 | 小说列表 |
| GET | /novel | `?id=xxx` | 详情页 | 小说详情 |
| POST | /novel/delete | body: `{id}` | 列表页 | 删除小说（级联删除） |
| GET | /novel/chapters | `?novel_title=xxx` 或 `?novel_id=xxx` | 章节页 | 查询已保存的章节 |
| GET | /novel/audio | `?novel_id=xxx` 或 `?novel_title=xxx` | 结果页 | 音频缓存记录 |
| GET | /novel/audio/chapter | `?chapter_title=xxx[&novel_id=xxx]` | 结果页 | 单章节音频查询 |
| GET | /characters | `?novel_id=xxx` (可选) | 角色管理页 | 角色/演讲者列表 |
| GET | /characters/detail | `?novel_id=xxx&role_name=xxx` | 角色编辑页 | 角色完整信息 |
| POST | /characters/update | body: `{novel_id, role_name, portrait}` | 角色编辑页 | 更新角色画像 |
| POST | /characters/delete | body: `{novel_id, role_name}` | 角色管理页 | 删除角色声音 |
| POST | /novel/speakers/register | body: `{novel_id, ...}` | 角色编辑页 | 手动注册角色声音 |
| POST | /novel/speakers/regenerate | body: `{novel_id, role_name}` | 角色编辑页 | 重新生成角色声音 |
| GET | /voices | — | 角色编辑页 | 预置音色列表（10种） |
| GET | /notifications | `?novel_id=xxx&unread_only=true` | 通知栏 | 通知列表 |
| POST | /notifications/read | body: `{id}` | 通知栏 | 标记单条已读 |
| POST | /notifications/read-all | body: `{novel_id}` (可选) | 通知栏 | 标记全部已读 |
| GET | /health | — | — | 健康检查 |
| GET | /speaker-samples/{filename} | — | 角色编辑页 | 角色示例音频静态文件 |

> 注意：`GET /task/:id` 是**唯一一个使用路径参数**的接口（`:id` 在路由路径中）。

---

## 4. 总览：三步流程

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│   ① 上传页                    ② 角色编辑页                        ③ 合成结果页          │
│                                                                                         │
│  ┌──────────────────┐     ┌─────────────────────────┐     ┌─────────────────────────┐   │
│  │ 输入小说标题       │     │  角色画像列表 + 编辑面板    │     │  轮询任务进度            │   │
│  │                   │     │                         │     │                         │   │
│  │ ■ 粘贴文本        │ ──> │  [林远] 声音描述编辑       │ ──> │  ■■■■□□□□ 60%          │   │
│  │   或上传文件       │     │   [林远] 试听/微调         │     │  □ 第一章 已完成 ▶      │   │
│  │                   │     │   [苏晴] 声音描述编辑       │     │  □ 第二章 合成中...     │   │
│  │ [上传并分析]       │     │   [苏晴] 试听/微调         │     │  □ 第三章 等待中        │   │
│  │                   │     │                         │     │                         │   │
│  │ 进度: ■■■■■□□□    │     │ [确认并合成] → 跳转结果页   │     │ [下载全部]  [返回编辑]   │   │
│  └──────────────────┘     └─────────────────────────┘     └─────────────────────────┘   │
│         │                         │                             │                      │
│         ▼                         ▼                             ▼                      │
│  POST /novel/upload       POST /novel/convert (async)     GET /task/:id (轮询)          │
│  → novel_title            → task_id, novel_id             → chapters[] (含 url)         │
│  → chapters (Paginated)   → task_status: "pending"        → task_status: "completed"   │
│         │                                                    │                          │
│         ▼                                                    ▼                          │
│  POST /novel/analyze                                     (任务完成后展示播放器)          │
│  → characters[]                                          POST /novel/synthesize         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. 页面路由设计

### 推荐路由结构

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | 首页 | 项目介绍 + 最近小说列表 |
| `/novels` | 小说列表 | 显示已有小说，支持删除 |
| `/novels/new` | 上传页 | 上传/粘贴小说文本 + 自动分析 |
| `/analyze` | 角色编辑页 | 查看、编辑角色画像，试听，确认合成 |
| `/result?task_id=xxx` | 合成结果页 | 轮询任务进度，展示/播放/下载音频 |
| `/novel-detail?id=xxx` | 小说详情页 | 查看小说章节、任务历史、音频缓存 |

> 注意：路由中不包含 `:novelId` 路径参数。前端自行管理 `novel_id` 和 `task_id`。

### 全局状态管理

```typescript
interface AppState {
  // 当前小说信息
  novelTitle: string | null;
  novelId: string | null;        // 从 convert/synthesize 等响应中获得

  // 上传阶段
  chapters: RawChapter[];
  uploadLoading: boolean;
  uploadError: string | null;

  // 分析阶段
  characters: CharacterPortrait[];
  analyzeLoading: boolean;
  analyzeError: string | null;

  // 编辑阶段
  editedCharacters: Record<string, Partial<CharacterPortrait>>;
  selectedCharacter: string | null;

  // 合成阶段 (异步任务)
  currentTaskId: string | null;
  taskStatus: 'idle' | 'submitting' | 'pending' | 'processing' | 'completed' | 'partial' | 'failed';
  taskProgress: TaskProgress | null;
  pollError: string | null;

  // 音频播放
  playingChapter: string | null;
  audioPlayer: HTMLAudioElement | null;

  // 通知
  unreadCount: number;
}

interface TaskProgress {
  totalChapters: number;
  completedChapters: number;
  failedChapters: number;
  chapters: ChapterProgress[];
}

interface ChapterProgress {
  title: string;
  status: 'pending' | 'annotating' | 'synthesizing' | 'merging' | 'completed' | 'failed' | 'cached';
  output_url: string | null;
  duration_seconds: number | null;
  error_message: string | null;
}
```

---

## 6. 页面详情

### 页面 1：上传页 `/novels/new`

```
┌──────────────────────────────────────────────────┐
│  Cloud Novels                                     │
│                                                   │
│  小说名称                                          │
│  ┌──────────────────────────────────────────┐     │
│  │ 输入小说标题                              │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  上传方式                                          │
│  ┌────────────────────┐  ┌────────────────────┐  │
│  │  粘贴文本           │  │  上传文件           │  │
│  └────────────────────┘  └────────────────────┘  │
│                                                   │
│  文本内容                                          │
│  ┌──────────────────────────────────────────┐     │
│  │ 第一章 相遇                                │     │
│  │ 日落西山。                                │     │
│  │ [林远]你到底是谁？                          │     │
│  │ [苏晴]我不会告诉你的。                      │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  已识别 X 章 · Y 个角色 (预览)                     │
│                                                   │
│  [       上传并分析角色      ]                      │
│                                                   │
│  进度: ████████░░░░  (分析中...)                   │
└──────────────────────────────────────────────────┘
```

#### 交互要点

1. **切换输入方式：** 选项卡切换"粘贴文本"和"上传文件"模式
2. **文件名提取标题：** 上传 .txt 文件时自动用文件名填充"小说名称"
3. **加载状态：** 上传和分析是连续两个请求，用一个加载状态即可
4. **上传响应：** `data.chapters.list` 即章节列表（注意解嵌套）
5. **上传成功后持久化：** 后端 `POST /novel/upload` 内部已写入 `novel_chapters` 表，但响应**不返回** `novel_id`
6. **数据流转：**

```
用户点击"上传并分析"
  │
  ├─ 粘贴模式 → POST /novel/upload (JSON body)
  │    body: { novel_title, content }
  │
  ├─ 文件模式 → POST /novel/upload (multipart)
  │    form: { novel_title, file }
  │
  ▼
得到 data.novel_title + data.chapters.list (RawChapter[])
  │
  ▼
自动调 POST /novel/analyze
  body: { novel_title, chapters: data.chapters.list }
  │
  ▼
得到 data.characters.list (CharacterPortrait[]) + data.character_count
  │
  ▼
跳转到 /analyze，携带 state: { novelTitle, chapters, characters }
```

#### 上传响应解析

```typescript
const data = envelope.data;
const chapters = data.chapters.list;   // RawChapter[]
const novelTitle = data.novel_title;
```

---

### 页面 2：角色编辑页 `/analyze`

```
┌──────────────────────────────────────────────────┐
│  ← 返回    星辰大海 · 角色编辑                     │
│                                                   │
│  角色列表                                        │
│  ┌──────────────────────────────────────────┐     │
│  │  ┌────────────────────────────────────┐  │     │
│  │  │ 👤 林远   男 · 二十二岁            〉  │     │
│  │  │   深沉浑厚的青年男声...              │     │
│  │  └────────────────────────────────────┘  │     │
│  │                                          │     │
│  │  ┌────────────────────────────────────┐  │     │
│  │  │ 👤 苏晴   女 · 十九岁            〉   │     │
│  │  │   清脆悦耳的少女声...               │     │
│  │  └────────────────────────────────────┘  │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  编辑面板: 林远                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │ 角色名: 林远                                 │  │
│  │ 性别: [男 ▼]  年龄: [二十二岁                │  │
│  │ 身高: [178cm]  体态: [健壮                  │  │
│  │                                             │  │
│  │ 性格标签:                                     │  │
│  │ [沉稳] [果断] [+添加]                         │  │
│  │                                             │  │
│  │ 声音描述 (关键):                               │  │
│  │ [低沉浑厚的青年男声，略带磁性，语气沉稳有力]        │  │
│  │ 说话风格:                                     │  │
│  │ [语速中等，吐字清晰，说话干脆利落]                │  │
│  │                                             │  │
│  │ voice_prompt (用于 CosyVoice 音色设计):         │  │
│  │ [专业男声，沉稳有力...]                        │  │
│  │                                             │  │
│  │ 预置音色: [龙飞 ▼]   [试听]                   │  │
│  │                                             │  │
│  │ 角色简介:                                     │  │
│  │ [小说主角，出身平凡但胸怀大志的年轻人...]           │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  [    取消    ]    [    确认并合成    ]              │
└──────────────────────────────────────────────────┘
```

#### 交互要点

1. **左侧角色列表：** 从 analyze 响应 `data.characters.list` 中获取，点击切换编辑对象
2. **编辑字段：** 所有字段可编辑，重点在 `voice_description` 和 `voice_prompt`
   - `voice_prompt` 来自后端 `CharacterPortrait`，是实际发送给 CosyVoice 声音设计 API 的 prompt 文本
   - 人工微调时可编辑此字段来调整音色（最长 500 字，超限会有服务端警告）
3. **试听：** 调用 `POST /tts` 用当前预置音色测试效果
   - 请求参数：`{ text, voice: 选中的预置音色 ID, speed: 1.0, format: "mp3" }`
   - 响应为裸二进制流，用 `URL.createObjectURL(blob)` 播放
4. **预置音色选择：** 通过 `GET /voices` 获取 10 种内置音色列表，在编辑面板中以下拉框展示
5. **确认并合成（异步）：**

```typescript
async function handleConfirmSynthesize() {
  const overrides = buildOverrides(characters, editedCharacters);
  const result = await convertNovel({
    novel_title: novelTitle,
    chapters,
    character_overrides: overrides,
    output_format: 'mp3',
    merge: false,
  });
  navigate(`/result?task_id=${result.task_id}`, {
    state: { novelTitle, novelId: result.novel_id, chapters }
  });
}
```

#### 数据流转

```
用户编辑 → editedCharacters (本地 state)
  │
  ▼ 点击"确认并合成"
POST /novel/convert (异步)
  body: {
    novel_title, chapters,
    character_overrides: buildOverrides(characters, editedCharacters),
    output_format: "mp3", merge: false
  }
  │
  ▼ (立即返回)
{ task_id: "uuid", task_status: "pending", novel_id: "uuid", total_chapters: 3 }
  │
  ▼
跳转到 /result?task_id=xxx，携带 novel_id 和 novelTitle
  │
  ▼
结果页开始轮询 GET /task/:task_id
```

---

### 页面 3：合成结果页 `/result?task_id=xxx`

```
┌──────────────────────────────────────────────────┐
│  ← 返回    星辰大海 · 合成结果                     │
│                                                   │
│  任务状态: 🟢 合成完成  (3/3 章)                   │
│  或:       🟡 合成中 60%  (2/3 章已完成)           │
│  或:       🔴 部分失败  (2/3 章成功, 1 章失败)      │
│                                                   │
│  章节列表                                          │
│  ┌──────────────────────────────────────────┐     │
│  │ ✅ 第一章 相遇                     03:24 ▶│     │
│  │    ────────████████████████────           │     │
│  │                                          │     │
│  │ 🔄 第二章 真相  合成中...               │     │
│  │    ────────████████░░░░░░░░              │     │
│  │                                          │     │
│  │ ⏳ 第三章 转折  等待中                   │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  已注册角色: 旁白 (longxiaochun) · 林远 (longfei)  │
│                                                   │
│  [  下载全部  ]  [  返回编辑  ]  [  重新合成  ]     │
└────────────────────────────────────────────────┘
```

#### 任务轮询逻辑

```typescript
const taskId = searchParams.get('task_id');

useEffect(() => {
  if (!taskId) return;
  const interval = setInterval(async () => {
    const task = await getTaskDetail(taskId);
    setTaskProgress(task);
    if (['completed', 'partial', 'failed'].includes(task.status)) {
      clearInterval(interval);
      setTaskFinal(task);
    }
  }, 2000);
  return () => clearInterval(interval);
}, [taskId]);
```

#### 接口响应结构 (GET /task/:id)

```typescript
interface TaskDetail {
  id: string;
  novel_id: string;
  task_type: 'convert' | 'synthesize';
  status: 'pending' | 'processing' | 'completed' | 'partial' | 'failed';
  output_format: string;
  merge: boolean;
  total_chapters: number;
  completed_chapters: number;
  failed_chapters: number;
  merged_url: string | null;
  characters_registered: string[] | null;
  character_analysis: Array<{ name: string; gender: string; voice_description: string }> | null;
  chapters: Array<{
    title: string;
    sort_order: number;
    status: 'pending' | 'annotating' | 'synthesizing' | 'merging' | 'completed' | 'failed' | 'cached';
    output_url: string | null;
    duration_seconds: number | null;
    error_message: string | null;
  }>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
```

#### 音频播放

```typescript
const BASE = 'http://localhost:3000';

function playChapterAudio(url: string) {
  const audio = new Audio(`${BASE}${url}`);
  audio.play();
}

function playMergedAudio(mergedUrl: string) {
  const audio = new Audio(`${BASE}${mergedUrl}`);
  audio.play();
}
```

#### 每条章节的视觉状态映射

| task_chapters.status | 前端展示 | 说明 |
|---|---|---|
| `pending` | ⏳ 等待中 | 排队等待处理 |
| `annotating` | 📝 标注中... | LLM 正在分析对话分段 |
| `synthesizing` | 🔊 合成中... | 逐句调用 CosyVoice |
| `merging` | 🔄 合并中... | 合并段落音频 |
| `completed` | ✅ 已完成 | 可播放和下载 |
| `failed` | ❌ 失败 | 显示 error_message |
| `cached` | ⚡ 缓存命中 | 内容未变更，复用之前结果 |

---

### 页面 4（新增）：小说详情/历史页 `/novel-detail?id=xxx`

```
┌──────────────────────────────────────────────────┐
│  ← 返回    星辰大海 · 小说详情                     │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ 章节列表                                      │  │
│  │  □ 第一章 相遇          [合成此章]            │  │
│  │  □ 第二章 真相          [合成此章]            │  │
│  │  □ 第三章 转折          [合成全部]            │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ 合成任务历史                                    │  │
│  │  🟢 2025-07-08 14:30  完整合成 (3/3)  [查看]│  │
│  │  🟡 2025-07-07 10:00  按需合成 (2/3)  [查看]│  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  角色管理                                          │
│  林远 [longfei] [试听] [删除声音] [重新生成]        │
│  苏晴 [longmiao] [试听] [删除声音] [重新生成]       │
│                                                   │
│  [  删除小说  ]                                    │
└────────────────────────────────────────────────┘
```

#### 功能点

1. **章节列表：** 通过 `GET /novel/chapters?novel_id=xxx` 获取已保存的章节
2. **按需合成：** 点击"合成此章"或"合成全部"调用 `POST /novel/synthesize`（异步任务）
3. **任务历史：** 通过 `GET /tasks?novel_id=xxx` 获取历史任务列表，点击查看详情
4. **角色管理：**
   - `GET /characters/detail?novel_id=xxx&role_name=xxx` → 查看完整角色信息
   - `POST /characters/delete` → 删除角色声音（下次合成会重新注册）
   - `POST /novel/speakers/regenerate` → 重新生成角色声音
5. **角色试听：** 如果有 `sample_audio_url`，通过 `GET /speaker-samples/{filename}` 播放

---

### 页面 5（新增）：通知栏/通知页

后端有完整的通知系统，记录合成任务的每个重要事件：

| type | 含义 | 使用场景 |
|---|---|---|
| `task_completed` | 任务全部完成 | 显示"《XX》合成完成" |
| `task_partial` | 任务部分完成 | 显示"N/M 章合成成功" |
| `task_failed` | 任务失败 | 显示失败原因 |
| `chapter_completed` | 单章完成 | 可逐个弹出 |
| `chapter_cached` | 单章命中缓存 | 提示用户内容未变 |

**接口**：
- `GET /notifications?novel_id=xxx&unread_only=true` — 列表
- `POST /notifications/read` body: `{id}` — 标记已读
- `POST /notifications/read-all` body: `{novel_id}` (可选) — 全部已读

前端可在 Header 中展示未读角标，点击展开通知列表。

---

## 7. 完整状态机

```
                       ┌─────────┐
                       │  IDLE   │
                       └────┬────┘
                            │ 用户填写信息
                            ▼
                     ┌─────────────┐
                     │  UPLOADING  │  POST /novel/upload
                     └──────┬──────┘
                    成功    │    失败 → 显示错误
                            ▼
                     ┌─────────────┐
                     │  ANALYZING  │  POST /novel/analyze (自动)
                     └──────┬──────┘
                    成功    │    失败 → 可重试
                            ▼
                     ┌──────────────┐
                     │  EDITING     │  编辑角色画像
                     └──────┬───────┘
                            │ 点击"确认并合成"
                            ▼
                     ┌───────────────┐
                     │  TASK_PENDING │  POST /novel/convert (立即返回 task_id)
                     └───────┬───────┘
                             │ 开始轮询
                             ▼
                     ┌─────────────────┐
                     │  TASK_PROCESSING │  GET /task/:id 轮询
                     │  显示逐章进度    │
                     └───────┬─────────┘
                             │
               ┌─────────────┼─────────────┐
               ▼             ▼             ▼
         completed       partial        failed
         全部成功       部分成功/部分失败  全部失败
               │             │             │
               ▼             ▼             ▼
         ┌──────────────────────────────┐
         │         RESULT               │
         │  播放/下载/管理               │
         └──────┬───────────────────────┘
                │
    ┌───────────┼───────────────┐
    ▼           ▼               ▼
 返回编辑     重新合成        回到首页
(EDITING)   (TASK_PENDING)   (IDLE)
```

---

## 8. 组件树建议

```
App
├── Layout
│   ├── Header
│   │   ├── Logo / Title
│   │   ├── NavLinks (首页, 小说列表)
│   │   └── NotificationBadge (未读角标 + 下拉列表)
│   └── Main
│
├── HomePage /
│   ├── Hero
│   └── RecentNovels (GET /novels)
│
├── NovelListPage /novels
│   ├── NovelCard[] (GET /novels)
│   └── DeleteConfirmModal (POST /novel/delete)
│
├── NovelDetailPage /novel-detail?id=xxx
│   ├── ChapterList (GET /novel/chapters)
│   ├── TaskHistory (GET /tasks)
│   │   └── TaskHistoryCard[]
│   ├── CharacterManagement
│   │   └── CharacterCard[] (GET /characters)
│   └── SynthesizeButton (POST /novel/synthesize)
│
├── UploadPage /novels/new
│   ├── TitleInput
│   ├── InputMethodSwitch (粘贴/文件切换)
│   ├── TextArea / FileUploader
│   ├── ChapterPreview
│   └── UploadButton (POST /novel/upload → POST /novel/analyze)
│
├── AnalyzePage /analyze
│   ├── CharacterList
│   │   └── CharacterCard[]
│   └── CharacterEditor
│       ├── PortraitForm
│       │   ├── BasicInfoFields (name, gender, age, height, build)
│       │   ├── PersonalityTags
│       │   ├── VoiceDescription (textarea, key field)
│       │   ├── SpeakingStyle (textarea)
│       │   ├── VoicePrompt (textarea, for CosyVoice prompt)
│       │   └── BackstorySummary (textarea)
│       ├── VoicePreview
│       │   ├── BaseVoiceSelector (GET /voices, dropdown)
│       │   └── TtsTestButton (POST /tts, returns audio blob)
│       └── ActionButtons (confirm → POST /novel/convert)
│
└── ResultPage /result?task_id=xxx
    ├── TaskProgressHeader
    │   ├── StatusBadge (pending/processing/completed/partial/failed)
    │   └── ProgressBar (completedChapters / totalChapters)
    ├── ChapterAudioList (轮询 GET /task/:id → chapters[])
    │   └── ChapterAudioCard[]
    │       ├── StatusIcon (⏳/🔄/✅/❌/⚡)
    │       ├── ChapterTitle
    │       ├── Duration
    │       ├── PlayButton / Spinner / ErrorMessage
    │       └── AudioProgressBar
    ├── CharacterSummary (characters_registered + character_analysis)
    └── ActionBar
        ├── DownloadAllButton
        ├── BackToEditButton (→ /analyze)
        └── ReConvertButton (POST /novel/convert again)
```

---

## 9. API 调用封装

```typescript
// ── api/client.ts — 基础封装 ──
const BASE = 'http://localhost:3000';

class ApiError extends Error {
  constructor(msg: string, public code?: number) { super(msg); }
}
class ValidationError extends Error {
  constructor(msg: string, public details?: unknown[]) { super(msg); }
}
class NotFoundError extends Error { constructor(msg: string) { super(msg); } }
class UpstreamError extends Error { constructor(msg: string) { super(msg); } }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 422 && body?.details) {
      const msgs = body.details.map((d: any) => `${d.path}: ${d.message}`).join('; ');
      throw new ValidationError(msgs, body.details);
    }
    if (res.status === 502) throw new UpstreamError(body?.errorMsg ?? '上游服务调用失败');
    if (res.status === 404) throw new NotFoundError(body?.errorMsg ?? '资源未找到');
    throw new ApiError(body?.errorMsg ?? '未知错误', res.status);
  }
  const envelope = await res.json();
  if (envelope.status !== 0) throw new ApiError(envelope.errorMsg ?? '业务错误', envelope.status);
  return envelope.data as T;
}

// ── api/novel.ts — 小说管理 ──

/** 上传文本 (JSON) */
export async function uploadNovel(body: { novel_title: string; content: string }) {
  return request<{ novel_title: string; chapters: PaginatedList<RawChapter> }>(
    `${BASE}/novel/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

/** 上传文件 (multipart) */
export async function uploadNovelFile(novelTitle: string, file: File) {
  const fd = new FormData();
  fd.append('novel_title', novelTitle);
  fd.append('file', file);
  const res = await fetch(`${BASE}/novel/upload`, { method: 'POST', body: fd });
  const env = await res.json();
  if (env.status !== 0) throw new Error(env.errorMsg);
  return env.data as { novel_title: string; chapters: PaginatedList<RawChapter> };
}

/** 分析角色 (同步，10-30s) */
export async function analyzeCharacters(body: {
  novel_title: string;
  chapters: Chapter[];
  character_descriptions?: Record<string, string>;
}) {
  return request<{ characters: PaginatedList<CharacterPortrait>; character_count: number }>(
    `${BASE}/novel/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

/** 异步合成 (完整管线)，立即返回 task_id */
export async function convertNovel(body: {
  novel_title: string;
  chapters: Chapter[];
  character_overrides?: Record<string, Partial<CharacterPortrait>>;
  output_format?: 'mp3' | 'wav' | 'pcm';
  merge?: boolean;
}) {
  return request<{ task_id: string; task_status: 'pending'; novel_id: string; total_chapters: number }>(
    `${BASE}/novel/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, output_format: body.output_format ?? 'mp3', merge: body.merge ?? false }),
    }
  );
}

/** 查询任务详情 (含逐章进度) */
export async function getTaskDetail(taskId: string) {
  return request<TaskDetail>(`${BASE}/task/${encodeURIComponent(taskId)}`);
}

/** 查询小说任务列表 */
export async function listTasks(novelId: string, limit = 20) {
  return request<{ tasks: { list: TaskRow[]; total: number } }>(
    `${BASE}/tasks?novel_id=${encodeURIComponent(novelId)}&limit=${limit}`
  );
}

/** 按需合成章节 (异步) */
export async function synthesizeChapters(body: {
  novel_id?: string; novel_title?: string;
  chapter_ids?: string[]; chapter_titles?: string[];
  all?: boolean; output_format?: 'mp3' | 'wav' | 'pcm'; merge?: boolean;
}) {
  return request<{ task_id: string; task_status: 'pending'; novel_id: string; total_chapters: number; chapter_titles: string[] }>(
    `${BASE}/novel/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

/** 小说列表 */
export async function listNovels() {
  return request<{ novels: PaginatedList<NovelRecord> }>(`${BASE}/novels`);
}

/** 小说详情 */
export async function getNovel(id: string) {
  return request<NovelRecord>(`${BASE}/novel?id=${encodeURIComponent(id)}`);
}

/** 删除小说 */
export async function deleteNovel(id: string) {
  return request<{ novel_id: string }>(`${BASE}/novel/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

/** 查询章节列表 */
export async function getChapters(params: { novel_title?: string; novel_id?: string }) {
  const qs = new URLSearchParams();
  if (params.novel_title) qs.set('novel_title', params.novel_title);
  if (params.novel_id) qs.set('novel_id', params.novel_id);
  return request<{ chapters: PaginatedList<ChapterRecord> }>(`${BASE}/novel/chapters?${qs}`);
}

// ── api/audio.ts — 音频缓存 ──

export async function getNovelAudio(params: { novel_id?: string; novel_title?: string }) {
  const qs = new URLSearchParams();
  if (params.novel_id) qs.set('novel_id', params.novel_id);
  if (params.novel_title) qs.set('novel_title', params.novel_title);
  return request<{ audio: PaginatedList<AudioCacheRecord> }>(`${BASE}/novel/audio?${qs}`);
}

export async function getChapterAudio(params: { chapter_title: string; novel_id?: string; novel_title?: string }) {
  const qs = new URLSearchParams({ chapter_title: params.chapter_title });
  if (params.novel_id) qs.set('novel_id', params.novel_id);
  if (params.novel_title) qs.set('novel_title', params.novel_title);
  return request<{ audio: PaginatedList<AudioCacheRecord> }>(`${BASE}/novel/audio/chapter?${qs}`);
}

// ── api/characters.ts — 角色管理 ──

export async function listCharacters(novelId?: string) {
  const q = novelId ? `?novel_id=${encodeURIComponent(novelId)}` : '';
  return request<{ characters: PaginatedList<SpeakerProfile> }>(`${BASE}/characters${q}`);
}

export async function getCharacterDetail(novelId: string, roleName: string) {
  return request<{
    novel_id: string; role_name: string; base_voice: string;
    speaker_id: string; description: string | null;
    sample_audio_url: string | null; portrait: CharacterPortrait | null;
  }>(`${BASE}/characters/detail?novel_id=${encodeURIComponent(novelId)}&role_name=${encodeURIComponent(roleName)}`);
}

export async function updateCharacterPortrait(novelId: string, roleName: string, portrait: CharacterPortrait) {
  return request<{ novel_id: string; role_name: string }>(`${BASE}/characters/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novel_id: novelId, role_name: roleName, portrait }),
  });
}

export async function deleteCharacter(novelId: string, roleName: string) {
  return request<{ role_name: string }>(`${BASE}/characters/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novel_id: novelId, role_name: roleName }),
  });
}

export async function regenerateSpeakerVoice(novelId: string, roleName: string, portraitOverride?: Partial<CharacterPortrait>) {
  return request<{ novel_id: string; role_name: string; base_voice: string; speaker_id: string }>(
    `${BASE}/novel/speakers/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novel_id: novelId, role_name: roleName, portrait_override: portraitOverride }),
    }
  );
}

// ── api/tts.ts — 单段试听 (返回裸音频 Blob) ──

export async function synthesizeTts(params: {
  text: string; voice?: string; speed?: number;
  format?: 'mp3' | 'wav' | 'pcm'; emotion?: string;
}): Promise<Blob> {
  const res = await fetch(`${BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: params.text,
      voice: params.voice ?? 'longxiaochun',
      speed: params.speed ?? 1.0,
      format: params.format ?? 'mp3',
      emotion: params.emotion,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.errorMsg ?? `TTS 合成失败 (${res.status})`);
  }
  return res.blob();
}

// ── api/notifications.ts — 通知 ──

export async function listNotifications(params: { novel_id?: string; unread_only?: boolean; limit?: number }) {
  const qs = new URLSearchParams();
  if (params.novel_id) qs.set('novel_id', params.novel_id);
  if (params.unread_only) qs.set('unread_only', 'true');
  if (params.limit) qs.set('limit', String(params.limit));
  return request<{ notifications: PaginatedList<NotificationItem>; unread_count: number }>(`${BASE}/notifications?${qs}`);
}

export async function markNotificationRead(id: string) {
  return request<{ id: string }>(`${BASE}/notifications/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
  });
}

export async function markAllNotificationsRead(novelId?: string) {
  return request<{ count: number }>(`${BASE}/notifications/read-all`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novel_id: novelId }),
  });
}
```

---

## 10. 数据模型

### Chapter（请求格式）
```typescript
interface Chapter { title: string; content: string; }
```

### RawChapter（上传响应格式）
```typescript
interface RawChapter { title: string; content: string; }
```

### CharacterPortrait
```typescript
interface CharacterPortrait {
  name: string;
  gender: "male" | "female" | "unknown";
  age: string;
  height: string;
  build: string;
  personality: string[];
  voice_description: string;      // 指导语音合成的关键字段
  speaking_style: string;
  voice_prompt?: string;          // 实际发给 CosyVoice 的 prompt（人工微调可编辑）
  backstory_summary: string;
}
```

### CharacterOverride（部分画像覆盖）
```typescript
interface CharacterOverride {
  voice_description?: string; gender?: "male" | "female" | "unknown";
  age?: string; height?: string; build?: string;
  personality?: string[]; speaking_style?: string; backstory_summary?: string;
}
```

### SpeakerProfile（数据库持久化角色）
```typescript
interface SpeakerProfile {
  id: string; novelId: string; roleName: string;
  baseVoice: string; description: string | null;
  portrait: CharacterPortrait | null;
  speakerId: string; sampleAudioPath: string | null;
  createdAt: string; updatedAt: string;
}
```

### NovelRecord
```typescript
interface NovelRecord {
  id: string; title: string; createdAt: string; updatedAt: string;
}
```

### ChapterRecord（数据库持久化章节）
```typescript
interface ChapterRecord {
  id: string; title: string; content: string; sortOrder: number; createdAt: string;
}
```

### AudioCacheRecord
```typescript
interface AudioCacheRecord {
  id: string; novel_id: string; chapter_title: string;
  content_hash: string; format: string; file_path: string;
  duration_seconds: number | null; created_at: string;
}
```

### NotificationItem
```typescript
interface NotificationItem {
  id: string; novel_id: string; task_id: string | null;
  type: 'task_completed' | 'task_failed' | 'task_partial' | 'chapter_completed' | 'chapter_failed' | 'chapter_cached';
  title: string; message: string | null;
  data: Record<string, unknown> | null; is_read: boolean; created_at: string;
}
```

### VoiceInfo
```typescript
interface VoiceInfo {
  id: string; name: string; gender: 'male' | 'female'; style: string; language: string;
}
```

### PaginatedList
```typescript
interface PaginatedList<T> {
  total: number; pageNum: number; pageSize: number; list: T[];
}
```

---

## 11. 完整超时与错误处理

### 加载与超时

| 接口 | 预计耗时 | 前端处理 |
|---|---|---|
| POST /novel/upload | < 1s | 普通 spinner |
| POST /novel/analyze | 10-30s | 进度条 + "正在分析角色..." |
| POST /novel/convert | 立即返回 (后台异步) | 跳转结果页，无等待 |
| GET /task/:id (轮询) | 2s/次 | 逐章进度展示 |
| **总合成时间** | **30s - 5min** | **轮询直到 completed/partial/failed** |
| POST /novel/synthesize | 立即返回 | 跳转结果页 |
| POST /tts | 1-3s | 试听按钮 loading |

> analyze 设 **60s 以上超时**。轮询设 **30min 最大超时**。

### 常见错误码

| errorMsg | 可能原因 | 前端处理 |
|---|---|---|
| "请求参数校验失败" | 必填字段缺失或格式错误 | 检查 body，展示 details |
| "小说未找到" | ID 不存在 | 提示用户或跳转回列表页 |
| "角色未找到" | 角色名不存在 | 检查角色名是否一致 |
| "该小说暂无章节记录，请先上传" | 未上传就查询章节 | 引导用户先上传 |
| "所有章节合成失败" | 合成全部失败 | 展示详细错误，建议重试 |
| "语音合成服务调用失败" | CosyVoice API 不可用 | 展示 502 错误 |

---

## 12. 注意事项

### 响应解嵌套

所有列表接口返回的数据都在 `data.xxx.list` 中：

```typescript
const chapters = response.data.chapters.list;       // upload
const characters = response.data.characters.list;   // analyze
const audioChapters = taskDetail.chapters;          // GET /task/:id 是裸数组！
```

> 注意：`GET /task/:id` 返回的 `chapters` 是**裸数组**，不是 PaginatedList。

### 角色名一致性

文本中的 `[角色名]` 必须与 `CharacterPortrait.name` 一致。如果用户在编辑页改了角色名，需要同步修改章节内容。

### 缓存策略

- 默认 `cache: true`，内容哈希不变则跳过合成
- 修改角色描述但不改文本 → 复用音频缓存
- 强制重新注册角色声音 → `POST /characters/delete` 后重新 convert
- 章节缓存可通过 `GET /novel/audio` 和 `GET /novel/audio/chapter` 查询

### novel_id 生命周期

- `POST /novel/upload` 响应**不返回** `novel_id`
- `POST /novel/convert` 和 `POST /novel/synthesize` 的响应会返回 `novel_id`
- 也可通过 `GET /novels` 获取所有小说的 ID 和 title
- 二次查询推荐用 `novel_id`

### 异步任务生命周期

- `POST /novel/convert` → 立即返回 `task_id`，后台异步处理
- 前端在结果页轮询 `GET /task/:id`，**不要阻塞等待**
- 轮询间隔建议 **2 秒**
- 任务最终状态：`completed` / `partial` / `failed`

### 跨页面数据传递

推荐使用 URL query params：

```
/analyze → /result?task_id=xxx&novel_id=xxx
/result → /novel-detail?id=xxx
```

### 预置音色列表 (GET /voices)

| ID | 名称 | 性别 | 风格 |
|---|---|---|---|
| longfei | 龙飞 | male | 成熟稳重 |
| longchuan | 龙川 | male | 清新自然 |
| longgang | 龙港 | male | 温暖亲切 |
| longyu | 龙雨 | male | 明亮 |
| xiaofeng | 晓峰 | male | 阳光 |
| longmiao | 龙妙 | female | 温柔甜美 |
| longhua | 龙华 | female | 自然亲切 |
| longyao | 龙瑶 | female | 知性 |
| longshuo | 龙硕 | male | 厚重沉稳 |
| longxiaochun | 龙小春 | female | 活泼 |

旁白默认使用 `longxiaochun`。

### 音频文件访问

- 章节音频：`/{novel_id_prefix}-{chapter_title}.{format}`
- 合并音频：`/{novel_id_prefix}-merged.{format}`
- 角色示例音频：`/speaker-samples/{filename}`

### 删除级联

`POST /novel/delete` 级联删除 `novel_chapters`、`speakers`、`audio_cache` 记录，**不删除实体音频文件**。
`POST /characters/delete` 仅删除数据库角色记录，下次合成会重新注册声音。
