# 前端流程图文档

> 面向前端开发者的用户操作流程指南。描述用户在页面上的完整操作路径、组件划分和数据流转。

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

### API Base URL

```
http://localhost:3000
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

## 2. 总览：三步流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│   ① 上传页                   ② 角色编辑页                    ③ 合成结果页    │
│                                                                             │
│  ┌──────────────────┐     ┌────────────────────┐     ┌────────────────┐     │
│  │ 输入小说标题       │     │  角色画像列表       │     │  章节列表+音频  │     │
│  │                   │     │                    │     │                │     │
│  │ ■ 粘贴文本        │ ──> │  [林远] 编辑按钮    │ ──> │  □ 第一章 ▶    │     │
│  │   或上传文件       │     │   [林远] 画像详情   │     │  □ 第二章 ▶    │     │
│  │                   │     │   [苏晴] 编辑按钮   │     │  □ 第三章 ▶    │     │
│  │ [上传并分析]       │     │   [苏晴] 画像详情   │     │                │     │
│  │                   │     │                    │     │ [下载全部]      │     │
│  │ 进度: ■■■■■□□□    │     │ [确认并合成]        │     │                │     │
│  └──────────────────┘     └────────────────────┘     └────────────────┘     │
│         │                         │                        │                │
│         ▼                         ▼                        ▼                │
│  POST /novel/upload       POST /novel/analyze      POST /novel/convert       │
│  → chapters (分页)       → characters[] (分页)     → chapter URLs + novel_id │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 页面路由设计

### 推荐路由结构

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | 首页 | 项目介绍 + 最近小说列表 |
| `/novels` | 小说列表 | 显示已有小说，支持删除 |
| `/novels/new` | 上传页 | 上传/粘贴小说文本 + 自动分析 |
| `/analyze` | 角色编辑页 | 查看和编辑角色画像 |
| `/result` | 合成结果页 | 播放和下载音频 |

> 注意：路由中不包含 `:novelId` 路径参数。前端自行通过 `novel_title` 或从 convert 响应中拿到 `novel_id` 后在 state 中管理。

### 全局状态管理

```typescript
interface AppState {
  // 当前小说信息
  novelTitle: string | null;
  novelId: string | null;        // 从 convert 响应中获得

  // 上传阶段
  chapters: RawChapter[];        // upload 返回的 data.chapters.list
  uploadLoading: boolean;

  // 分析阶段
  characters: CharacterPortrait[];
  analyzeLoading: boolean;

  // 编辑阶段
  editedCharacters: Record<string, Partial<CharacterPortrait>>;

  // 合成阶段
  convertLoading: boolean;
  result: ConvertResult | null;

  // 音频播放
  playingChapter: string | null;
}
```

---

## 4. 页面详情

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
│  │  📝 手动粘贴       │  │  📄 .txt 文件      │  │
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
│  已识别 X 章 · Y 个角色                            │
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
5. **数据流转：**

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
得到 data.characters.list (CharacterPortrait[])
  │
  ▼
跳转到 /analyze，携带 state: { novelTitle, chapters, characters }
```

---

### 页面 2：角色编辑页 `/analyze`

```
┌──────────────────────────────────────────────────┐
│  ← 返回    星辰大海 · 角色编辑                     │
│                                                   │
│  ┌──────────────────────────────────────────┐     │
│  │ 角色列表                                   │     │
│  │                                           │     │
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
│  │                                    [试听]     │  │
│  │                                             │  │
│  │ 说话风格:                                     │  │
│  │ [语速中等，吐字清晰，说话干脆利落]                │  │
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
2. **编辑字段：** 所有字段可编辑，重点在 `voice_description`
3. **试听：** 调用 `POST /tts` 测试当前声音描述效果（可选功能）
4. **确认并合成：**

```typescript
function buildOverrides(
  originals: CharacterPortrait[],
  edits: Record<string, Partial<CharacterPortrait>>
): Record<string, Partial<CharacterPortrait>> {
  const overrides: Record<string, Partial<CharacterPortrait>> = {};
  for (const [name, changed] of Object.entries(edits)) {
    const original = originals.find(c => c.name === name);
    if (!original) continue;
    const diff: Partial<CharacterPortrait> = {};
    for (const [key, value] of Object.entries(changed)) {
      if (JSON.stringify(value) !== JSON.stringify((original as any)[key])) {
        (diff as any)[key] = value;
      }
    }
    if (Object.keys(diff).length > 0) overrides[name] = diff;
  }
  return overrides;
}
```

#### 数据流转

```
用户编辑 → editedCharacters (本地 state)
  │
  ▼ 点击"确认并合成"
POST /novel/convert
  body: {
    novel_title,
    chapters,
    character_overrides: buildOverrides(characters, editedCharacters),
    output_format: "mp3",
    merge: false,
    cache: true,
  }
  │
  ▼
响应 data:
{
  task_id,
  task_status,          // "completed" 或 "processing"
  novel_id,             // 需要保存供后续管理查询
  chapters: { list: [{ title, duration_seconds, url }] },
  characters_registered,
  character_analysis,
  merged_url?            // merge=true 时返回
}
  │
  ▼
跳转到 /result，携带 data
```

---

### 页面 3：合成结果页 `/result`

```
┌──────────────────────────────────────────────────┐
│  ← 返回    星辰大海 · 合成结果                     │
│                                                   │
│  ✅ 合成完成  (X 章 / X 章成功)                    │
│                                                   │
│  章节列表                                          │
│  ┌──────────────────────────────────────────┐     │
│  │ ▶ 第一章 相遇                     03:24  │     │
│  │    ────────████████████████────           │     │
│  │                                          │     │
│  │ ▶ 第二章 真相                     04:11  │     │
│  │    ────────████████████████────           │     │
│  │                                          │     │
│  │ ▶ 第三章 转折                     05:02  │     │
│  │    ────────████████████████────           │     │
│  │   ...                                    │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  已注册角色: 旁白 (longxiaochun) · 林远 (longfei) · 苏晴 (longmiao) │
│                                                   │
│  [  下载全部  ]  [  返回编辑  ]  [  再次合成  ]      │
└────────────────────────────────────────────────┘
```

#### 音频播放

```typescript
// 音频 URL 为相对路径，需拼接 base URL
function playChapterAudio(url: string) {
  const audio = new Audio(`http://localhost:3000${url}`);
  audio.play();
}

// 合并音频（如果 merge=true，有 merged_url）
function playMergedAudio(mergedUrl: string) {
  const audio = new Audio(`http://localhost:3000${mergedUrl}`);
  audio.play();
}
```

#### 合成状态展示

```typescript
// task_status 说明
if (result.task_status === 'completed') {
  // 全部成功
} else if (result.task_status === 'processing') {
  // 部分章节成功（部分失败）
}
```

---

## 5. 完整状态机

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
                     ┌─────────────┐
                     │  CONVERTING  │  POST /novel/convert
                     └──────┬──────┘
                    成功    │    失败 → 可重试
                            ▼
                     ┌─────────────┐
                     │  RESULT     │  播放/下载
                     └──────┬──────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
      返回编辑           再次合成         回到首页
      (EDITING)        (CONVERTING)      (IDLE)
```

---

## 6. API 调用封装

```typescript
// api/client.ts — 基础封装
const BASE = 'http://localhost:3000';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 422 && body?.details) {
      const messages = body.details.map((d: any) => `${d.path}: ${d.message}`).join('; ');
      throw new Error(messages);
    }
    throw new Error(body?.errorMsg ?? `HTTP ${res.status}`);
  }

  const envelope = await res.json();
  if (envelope.status !== 0) {
    throw new Error(envelope.errorMsg ?? '业务错误');
  }
  return envelope.data as T;
}

// api/novel.ts
export async function uploadNovel(body: {
  novel_title: string;
  content: string;
}) {
  return request<{
    novel_title: string;
    chapters: PaginatedList<RawChapter>;
  }>(`${BASE}/novel/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function uploadNovelFile(novelTitle: string, file: File) {
  const formData = new FormData();
  formData.append('novel_title', novelTitle);
  formData.append('file', file);
  const res = await fetch(`${BASE}/novel/upload`, { method: 'POST', body: formData });
  const env = await res.json();
  if (env.status !== 0) throw new Error(env.errorMsg);
  return env.data as { novel_title: string; chapters: PaginatedList<RawChapter> };
}

export async function analyzeCharacters(body: {
  novel_title: string;
  chapters: Chapter[];
  character_descriptions?: Record<string, string>;
}) {
  return request<{
    characters: PaginatedList<CharacterPortrait>;
    character_count: number;
  }>(`${BASE}/novel/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function convertNovel(body: {
  novel_title: string;
  chapters: Chapter[];
  character_overrides?: Record<string, Partial<CharacterPortrait>>;
  output_format?: 'mp3' | 'wav' | 'pcm';
  merge?: boolean;
  cache?: boolean;
}) {
  return request<{
    task_id: string;
    task_status: 'completed' | 'processing';
    novel_id: string;
    chapters: PaginatedList<{ title: string; duration_seconds: number; url: string }>;
    characters_registered: string[];
    character_analysis: Array<{ name: string; gender: string; voice_description: string }>;
    merged_url?: string;
  }>(`${BASE}/novel/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      output_format: body.output_format ?? 'mp3',
      merge: body.merge ?? false,
      cache: body.cache ?? true,
    }),
  });
}

export async function getNovel(id: string) {
  return request<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  }>(`${BASE}/novel?id=${encodeURIComponent(id)}`);
}

export async function deleteNovel(id: string) {
  return request<{ novel_id: string }>(`${BASE}/novel/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export async function listCharacters(novelId?: string) {
  const query = novelId ? `?novel_id=${encodeURIComponent(novelId)}` : '';
  return request<{ characters: PaginatedList<SpeakerProfile> }>(`${BASE}/characters${query}`);
}

export async function deleteCharacter(novelId: string, roleName: string) {
  return request<{ role_name: string }>(`${BASE}/characters/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novel_id: novelId, role_name: roleName }),
  });
}

export async function getChapterAudio(novelId: string) {
  return request<{ audio: PaginatedList<ChapterAudioRecord> }>(
    `${BASE}/novel/audio?novel_id=${encodeURIComponent(novelId)}`
  );
}

// api/tts.ts
export async function synthesizeTts(params: {
  text: string;
  voice?: string;
  speed?: number;
  format?: 'mp3' | 'wav' | 'pcm';
  emotion?: string;
}): Promise<Blob> {
  const res = await fetch(`${BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...params,
      voice: params.voice ?? 'longxiaochun',
      speed: params.speed ?? 1.0,
      format: params.format ?? 'mp3',
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.errorMsg ?? `TTS 合成失败 (${res.status})`);
  }
  return res.blob();
}
```

---

## 7. 组件树建议

```
App
├── Layout
│   ├── Header
│   └── Main
│
├── HomePage /
│   ├── Hero
│   └── RecentNovels
│
├── NovelListPage /novels
│   └── NovelCard[]
│
├── UploadPage /novels/new
│   ├── TitleInput
│   ├── InputMethodSwitch (粘贴/文件切换)
│   ├── TextArea
│   ├── FileUploader
│   ├── ChapterPreview
│   └── UploadButton
│
├── AnalyzePage /analyze
│   ├── CharacterList
│   │   └── CharacterCard[]
│   └── CharacterEditor
│       ├── PortraitForm
│       ├── VoicePreview
│       └── ActionButtons
│
└── ResultPage /result
    ├── ChapterAudioList
    │   └── ChapterAudioCard[]
    │       ├── PlayButton
    │       └── ProgressBar
    └── ActionBar
        ├── DownloadAllButton
        ├── BackToEditButton
        └── ReConvertButton
```

---

## 8. 注意事项

### 加载与超时

| 接口 | 预计耗时 | 前端处理 |
|---|---|---|
| POST /novel/upload | < 1s | 普通 spinner |
| POST /novel/analyze | 10-30s | 显示"正在分析角色..." |
| POST /novel/convert | 30s-5min | 全屏遮罩"正在合成语音..." |

建议 analyze 和 convert 设 **60s 以上超时**。

### 响应解嵌套

所有列表接口返回的数据都在 `data.xxx.list` 中：

```typescript
// upload 取章节
const chapters = response.data.chapters.list;

// analyze 取角色
const characters = response.data.characters.list;

// convert 取结果
const audioChapters = response.data.chapters.list;
const novelId = response.data.novel_id;
```

### 角色名一致性

文本中的 `[角色名]` 必须与 `CharacterPortrait.name` 一致。如果用户在编辑页改了角色名，需要同步修改章节内容。建议提供"全局替换角色名"功能。

### 缓存策略

- `cache: true` 时内容哈希不变则跳过合成
- 修改角色描述但不改文本 → 复用音频缓存
- 强制重新合成 → 传 `cache: false`
- 强制重新注册角色声音 → `POST /characters/delete` 后重新 convert

### novel_id 生命周期

- `POST /novel/upload` 内部已持久化小说和章节，但响应**不返回** `novel_id`
- `POST /novel/convert` 的响应会返回 `novel_id`，前端应保存以供后续管理查询
- 也可以通过 `GET /novels` 列表获取所有小说的 ID
- `novel_title` 可作为临时业务键，但二次查询推荐用 `novel_id`
