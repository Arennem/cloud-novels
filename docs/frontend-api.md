# 前端接口技术文档

> 面向前端开发者的 API 参考。后端地址：`http://localhost:3000`

---

## 目录

1. [通用约定](#1-通用约定)
2. [三步工作流总览](#2-三步工作流总览)
3. [POST /novel/upload — 上传文本](#3-post-novelupload--上传文本)
4. [POST /novel/analyze — 分析角色](#4-post-novelanalyze--分析角色)
5. [POST /novel/convert — 合成语音](#5-post-novelconvert--合成语音)
6. [POST /tts — 单段合成](#6-post-tts--单段合成)
7. [管理接口](#7-管理接口)
8. [章节与音频缓存查询](#8-章节与音频缓存查询)
9. [数据模型](#9-数据模型)
10. [错误处理](#10-错误处理)
11. [附录：character_overrides 用法](#11-附录character_overrides-用法)

---

## 1. 通用约定

### Base URL

```
http://localhost:3000
```

### Content-Type

| 接口 | Content-Type |
|---|---|
| POST /novel/upload | `application/json` 或 `multipart/form-data` |
| 其余 POST | `application/json` |
| GET | query string 传参 |

### ID 传递约定

**所有接口都不使用路径参数（`:novelId` 风格）**，ID 通过以下方式传递：

- `GET` 请求 → URL query string，如 `GET /novel?id=xxx`
- 删除类操作 → `POST` 请求 + JSON body，如 `POST /novel/delete` body `{ "id": "xxx" }`
- 列表过滤 → query string，如 `GET /characters?novel_id=xxx`
- 可选通过小说标题查询 → `novel_title=xxx` query string

### 响应格式

所有响应（成功和失败）都使用统一 JSON 信封包裹。

**成功响应：**

```jsonc
{
  "status": 0,
  "data": { /* 业务数据，见各接口说明 */ },
  "errorMsg": null,
  "timestamp": "2025-07-08 14:30:00",
  "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**失败响应：**

```jsonc
{
  "status": 422,
  "data": null,
  "errorMsg": "请求参数校验失败",
  "details": [
    { "path": "novel_title", "message": "小说名称必填" }
  ],
  "timestamp": "2025-07-08 14:30:00",
  "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

`status` 字段释义：

| status 值 | 含义 |
|---|---|
| 0 | 成功 |
| 1+ / 非 0 | 业务错误 |
| 422 | 参数校验失败（含 details 数组） |

### 分页格式

所有返回列表的字段统一使用分页结构，不是裸数组：

```jsonc
{
  "total": 10,
  "pageNum": 1,
  "pageSize": 10,
  "list": [ /* 实际数据 */ ]
}
```

### HTTP 状态码

| 状态码 | 含义 |
|---|---|
| 200 | 成功 |
| 400 | 请求格式错误 |
| 422 | 参数校验失败，含 details 数组 |
| 404 | 资源未找到 |
| 500 | 服务器错误 |
| 502 | 上游 API 调用失败 |

### CORS

已全局开启，前端无需额外配置。

---

## 2. 三步工作流总览

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  上传页      │ ──> │  分析页      │ ──> │  编辑页      │ ──> │  合成结果页   │
│  upload     │     │  analyze    │     │  编辑画像    │     │  convert    │
│  → chapters │     │  → 展示画像  │     │  → confirm  │     │  → 播放音频  │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
    ① POST             ② POST                   ③ POST
    /novel/upload       /novel/analyze            /novel/convert
```

---

## 3. POST /novel/upload — 上传文本

### 功能

接收原始小说文本，按章节标题自动拆分，返回结构化章节列表。章节数据会持久化到数据库。

### 请求 A：JSON body

```http
POST /novel/upload
Content-Type: application/json

{
  "novel_title": "星辰大海",
  "content": "第一章 相遇\n日落西山。\n[林远]你到底是谁？\n\n第二章 真相\n[苏晴]我不会告诉你的。"
}
```

### 请求 B：multipart/form-data（文件上传）

| 字段 | 类型 | 说明 |
|---|---|---|
| novel_title | text | 小说名称 |
| file | file | .txt 文件，UTF-8，上限 50MB |

### 响应

```jsonc
// 外层信封 status=0，data 内部：
{
  "novel_title": "星辰大海",
  "chapters": {
    "total": 2,
    "pageNum": 1,
    "pageSize": 2,
    "list": [
      { "title": "第一章 相遇", "content": "日落西山。\n[林远]你到底是谁？" },
      { "title": "第二章 真相", "content": "[苏晴]我不会告诉你的。" }
    ]
  }
}
```

### 文本格式

- 章节标题支持：`第X章` / `第X节` / `第X部` / `第X集` / `# 标题`（Markdown）
- 对话行约定：`[角色名]对话内容`，无标记行为旁白
- 找不到标题时整篇作为"正文"一章

### 前端取数

```typescript
const { data } = await response.json();
const chapters = data.chapters.list; // Chapter[]
```

---

## 4. POST /novel/analyze — 分析角色

### 功能

将章节文本发给大模型分析角色画像。**不产生语音合成费用。**

### 请求

```http
POST /novel/analyze
Content-Type: application/json

{
  "novel_title": "星辰大海",
  "chapters": [
    {
      "title": "第一章 相遇",
      "content": "日落西山。\n[林远]你到底是谁？\n[苏晴]我不会告诉你的。"
    }
  ],
  "character_descriptions": {
    "林远": "二十二岁青年，沉稳果断"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| novel_title | string | 是 | 小说名称 |
| chapters | Chapter[] | 是 | 至少一章 |
| character_descriptions | Record<string, string> | 否 | 手动补充的声音描述（优先级高于 LLM） |

### 响应

```jsonc
// data 内部：
{
  "characters": {
    "total": 2,
    "pageNum": 1,
    "pageSize": 2,
    "list": [
      {
        "name": "林远",
        "gender": "male",
        "age": "二十二岁",
        "height": "约178cm",
        "build": "健壮",
        "personality": ["沉稳", "果断"],
        "voice_description": "低沉浑厚的青年男声，略带磁性，语气沉稳有力",
        "speaking_style": "语速中等，吐字清晰，说话干脆利落",
        "backstory_summary": "小说主角，出身平凡但胸怀大志的年轻人..."
      }
    ]
  },
  "character_count": 2
}
```

> `character_count` 与 `characters.list.length` 一致，取其一即可。

### 前端建议

- 此接口可能耗时 10-30 秒，务必展示 loading
- 拿到结果后进入"编辑角色"视图，让用户逐一审查和编辑
- 编辑完后，将修改过的字段收集为 `character_overrides` 传给 convert

---

## 5. POST /novel/convert — 合成语音

### 功能

完整流程：角色分析 → 注册声音 → 逐句合成 → 输出音频。**会产生 CosyVoice API 费用。**

### 请求

```http
POST /novel/convert
Content-Type: application/json

{
  "novel_title": "星辰大海",
  "chapters": [
    {
      "title": "第一章 相遇",
      "content": "日落西山。\n[林远]你到底是谁？\n[苏晴]我不会告诉你的。"
    }
  ],
  "character_descriptions": {
    "林远": "二十二岁青年，沉稳果断"
  },
  "character_overrides": {
    "林远": {
      "voice_description": "成熟稳重的三十岁男声，略带沙哑，语速偏慢"
    }
  },
  "output_format": "mp3",
  "merge": false,
  "cache": true
}
```

### 请求字段

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| novel_title | string | 是 | — | 小说名称，业务键 |
| chapters | Chapter[] | 是 | — | 至少一章 |
| character_descriptions | Record<string, string> | 否 | — | 补充描述（优先级高于 LLM） |
| character_overrides | Record<string, Partial<CharacterPortrait>> | 否 | — | 完整画像覆盖（最高优先级） |
| output_format | "mp3" / "wav" / "pcm" | 否 | "mp3" | 输出格式 |
| merge | boolean | 否 | false | 是否合并为单音频（合并后额外返回 merged_url） |
| cache | boolean | 否 | true | 内容哈希不变则跳过合成 |

### 画像合并优先级

```
LLM 分析结果  <  character_descriptions  <  character_overrides

最低优先级                               最高优先级
```

### 响应

```jsonc
// data 内部：
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "task_status": "completed",
  "novel_id": "b2c3d4e5-f6a7-...",
  "chapters": {
    "total": 2,
    "pageNum": 1,
    "pageSize": 2,
    "list": [
      {
        "title": "第一章 相遇",
        "duration_seconds": 48.5,
        "url": "/b2c3d4e5-第一章%20相遇.mp3"
      }
    ]
  },
  "characters_registered": ["旁白","林远", "苏晴"],
  "character_analysis": [
    { "name": "林远", "gender": "male", "voice_description": "低沉浑厚的青年男声" },
    { "name": "苏晴", "gender": "female", "voice_description": "清脆悦耳的少女声" }
  ],
  "merged_url": "/b2c3d4e5-merged.mp3"   // 仅在 merge=true 时出现
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| task_id | string (uuid) | 任务唯一 ID |
| task_status | `"completed"` / `"processing"` | 完成或部分完成（全部成功=completed，部分失败=processing） |
| novel_id | string | 小说持久化 ID，后续查询管理用 |
| chapters | paginated list | 每章的音频 URL（以 `/` 开头的相对路径） |
| characters_registered | string[] | 本次实际注册的角色名列表（含"旁白"） |
| character_analysis | object[] | 最终用于合成的角色画像摘要 |
| merged_url | string (可选) | 合并后的完整音频路径，仅在 merge=true 时出现 |

### 音频 URL

```typescript
const audioUrl = `http://localhost:3000${chapter.url}`;
```

---

## 6. POST /tts — 单段合成

### 功能

单段文本快速合成，用于试听和调试。**直接返回二进制音频流，不是 JSON。**

### 请求

```http
POST /tts
Content-Type: application/json

{
  "text": "这是一个测试文本。",
  "voice": "longxiaochun",
  "speed": 1.0,
  "format": "mp3",
  "emotion": "happy"
}
```

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| text | string | 是 | — | 合成文本，最长 500 字 |
| voice | string | 否 | "longxiaochun" | 预置音色 ID |
| speed | number | 否 | 1.0 | 语速，范围 0.5 ~ 2.0 |
| format | "mp3" / "wav" / "pcm" | 否 | "mp3" | 音频格式 |
| emotion | "happy" / "sad" / "angry" / "surprise" / "calm" / "default" | 否 | — | 情感参数（可选，部分音色不支持） |

### 响应（纯二进制流）

```
200
Content-Type: audio/mpeg

<二进制音频数据>
```

### 前端处理

```typescript
const res = await fetch('/tts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, voice, speed: 1.0, format: 'mp3' }),
});
const blob = await res.blob();
const url = URL.createObjectURL(blob);
audioElement.src = url;
```

> 注意：`POST /tts` 返回的是裸音频二进制流，**不走 JSON 信封封装**。

---

## 7. 管理接口

> 所有 ID 均通过 query string（GET）或 body（POST）传递，不使用路径参数。
> 以下示例中 `data` 字段即响应信封中的 `data`。

### 接口一览

| 方法 | 路径 | 传参方式 | 说明 |
|---|---|---|---|
| GET | /novels | — | 列出所有小说 |
| GET | /novel | `?id=xxx` | 查小说详情 |
| POST | /novel/delete | `body: { id }` | 删除小说 |
| GET | /characters | `?novel_id=xxx` 可选 | 列出角色（不带 novel_id 则列出全部） |
| POST | /characters/delete | `body: { novel_id, role_name }` | 删除角色声音 |
| GET | /voices | — | 预置音色列表 |
| GET | /health | — | 健康检查 |

### GET /novels

```http
GET /novels

→ 信封中的 data:
{
  "novels": {
    "total": 1,
    "pageNum": 1,
    "pageSize": 1,
    "list": [
      {
        "id": "b2c3d4e5-...",
        "title": "星辰大海",
        "createdAt": "2025-07-08T14:30:00.000Z",
        "updatedAt": "2025-07-08T14:30:00.000Z"
      }
    ]
  }
}
```

### GET /novel

```http
GET /novel?id=b2c3d4e5-f6a7-...

→ 信封中的 data:
{
  "id": "b2c3d4e5-...",
  "title": "星辰大海",
  "createdAt": "2025-07-08T14:30:00.000Z",
  "updatedAt": "2025-07-08T14:30:00.000Z"
}

→ 404: 信封 data=null, errorMsg="小说未找到"
```

### POST /novel/delete

```http
POST /novel/delete
Content-Type: application/json

{ "id": "b2c3d4e5-f6a7-..." }

→ 信封中的 data:
{
  "novel_id": "b2c3d4e5-..."
}

→ 404: 信封 data=null, errorMsg="小说未找到"
```

> 级联删除该小说下所有章节记录和角色声音，**不删除实体音频文件**。

### GET /characters

```http
# 列出所有角色
GET /characters

# 列出某部小说的角色（不含"旁白"）
GET /characters?novel_id=b2c3d4e5-f6a7-...

→ 信封中的 data:
{
  "characters": {
    "total": 2,
    "pageNum": 1,
    "pageSize": 2,
    "list": [
      {
        "id": "uuid",
        "novelId": "b2c3d4e5-...",
        "roleName": "林远",
        "baseVoice": "longfei",
        "description": "低沉浑厚的青年男声",
        "portrait": { /* CharacterPortrait 完整对象，可能为 null */ },
        "speakerId": "cosyvoice-speaker-id",
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
}
```

### POST /characters/delete

```http
POST /characters/delete
Content-Type: application/json

{ "novel_id": "b2c3d4e5-f6a7-...", "role_name": "林远" }

→ 信封中的 data:
{
  "role_name": "林远"
}

→ 404: 信封 data=null, errorMsg="角色未找到"
```

> 删除后下次合成时会重新注册声音。

### GET /voices

```http
GET /voices

→ 信封中的 data:
{
  "voices": {
    "total": 10,
    "pageNum": 1,
    "pageSize": 10,
    "list": [
      { "id": "longfei",     "name": "龙飞",   "gender": "male",   "style": "成熟稳重", "language": "zh-CN" },
      { "id": "longchuan",   "name": "龙川",   "gender": "male",   "style": "清新自然", "language": "zh-CN" },
      { "id": "longgang",    "name": "龙港",   "gender": "male",   "style": "温暖亲切", "language": "zh-CN" },
      { "id": "longyu",      "name": "龙雨",   "gender": "male",   "style": "明亮",     "language": "zh-CN" },
      { "id": "xiaofeng",    "name": "晓峰",   "gender": "male",   "style": "阳光",     "language": "zh-CN" },
      { "id": "longmiao",    "name": "龙妙",   "gender": "female", "style": "温柔甜美", "language": "zh-CN" },
      { "id": "longhua",     "name": "龙华",   "gender": "female", "style": "自然亲切", "language": "zh-CN" },
      { "id": "longyao",     "name": "龙瑶",   "gender": "female", "style": "知性",     "language": "zh-CN" },
      { "id": "longshuo",    "name": "龙硕",   "gender": "male",   "style": "厚重沉稳", "language": "zh-CN" },
      { "id": "longxiaochun","name": "龙小春", "gender": "female", "style": "活泼",     "language": "zh-CN" }
    ]
  }
}
```

### GET /health

```http
GET /health

→ 信封中的 data:
{
  "novels_count": 1,
  "speakers_count": 3
}
```

---

## 8. 章节与音频缓存查询

> 章节数据和音频缓存通过独立的 GET 端点查询，供前端展示和历史记录使用。

### 接口一览

| 方法 | 路径 | 传参方式 | 说明 |
|---|---|---|---|
| GET | /novel/chapters | `?novel_title=xxx` 或 `?novel_id=xxx` | 查询已保存的章节列表 |
| GET | /novel/audio | `?novel_id=xxx` 或 `?novel_title=xxx` | 查询小说的音频缓存记录 |
| GET | /novel/audio/chapter | `?chapter_title=xxx[&novel_id=xxx]` 或 `?chapter_title=xxx[&novel_title=xxx]` | 按章节标题查询音频缓存 |

### GET /novel/chapters

```http
GET /novel/chapters?novel_title=星辰大海
GET /novel/chapters?novel_id=b2c3d4e5-f6a7-...

→ 信封中的 data:
{
  "chapters": {
    "total": 2,
    "pageNum": 1,
    "pageSize": 2,
    "list": [
      {
        "id": "uuid",
        "title": "第一章 相遇",
        "content": "日落西山。\n[林远]你到底是谁？",
        "sortOrder": 1
      }
    ]
  }
}

→ 404: 该小说暂无章节记录（需要先上传）
```

> `novel_title` 和 `novel_id` 至少提供其一，不可同时缺失。

### GET /novel/audio

```http
GET /novel/audio?novel_id=b2c3d4e5-f6a7-...
GET /novel/audio?novel_title=星辰大海

→ 信封中的 data:
{
  "audio": {
    "total": 2,
    "pageNum": 1,
    "pageSize": 2,
    "list": [
      {
        "id": "uuid",
        "novel_id": "b2c3d4e5-...",
        "chapter_title": "第一章 相遇",
        "content_hash": "sha256-hex",
        "format": "mp3",
        "file_path": "F:\\coding\\cloud-novels\\output\\audio\\b2c3d4e5-...mp3",
        "duration_seconds": null,
        "created_at": "2025-07-08 14:30:00",
        "novel_title": "星辰大海"
      }
    ]
  }
}
```

### GET /novel/audio/chapter

```http
# 按章节标题模糊搜索
GET /novel/audio/chapter?chapter_title=相遇
# 限指定小说
GET /novel/audio/chapter?chapter_title=相遇&novel_id=b2c3d4e5-f6a7-...

→ 信封中的 data:
{
  "audio": {
    "total": 1,
    "pageNum": 1,
    "pageSize": 1,
    "list": [/* 同 /novel/audio 的单项结构 */]
  }
}
```

> `chapter_title` 使用 LIKE 模糊匹配，支持按标题关键词搜索。
> `novel_id` 和 `novel_title` 不能同时提供。

---

## 9. 数据模型

### Chapter（请求格式）

```typescript
interface Chapter {
  title: string;    // 章节标题
  content: string;  // 含 [角色名] 标记的文本
}
```

### RawChapter（上传响应格式）

```typescript
interface RawChapter {
  title: string;
  content: string;
}
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
  voice_description: string;   // 指导语音合成的关键字段
  speaking_style: string;
  backstory_summary: string;
}
```

### CharacterOverride（部分画像覆盖）

```typescript
interface CharacterOverride {
  voice_description?: string;
  gender?: "male" | "female" | "unknown";
  age?: string;
  height?: string;
  build?: string;
  personality?: string[];
  speaking_style?: string;
  backstory_summary?: string;
}
```

### SpeakerProfile

```typescript
interface SpeakerProfile {
  id: string;
  novelId: string;
  roleName: string;
  baseVoice: string;       // 基础预置音色 ID
  description: string | null;
  portrait: CharacterPortrait | null;  // 完整的角色画像对象
  speakerId: string;       // CosyVoice 侧的 speaker ID
  createdAt: string;
  updatedAt: string;
}
```

### NovelRecord

```typescript
interface NovelRecord {
  id: string;
  title: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}
```

### PaginatedList

```typescript
interface PaginatedList<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  list: T[];
}
```

---

## 10. 错误处理

### 前端错误处理示例

```typescript
async function apiCall<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);

  // POST /tts 返回裸二进制流，不走此封装
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 422 && body?.details) {
      throw new ValidationError(body.details);
    }
    if (res.status === 502) {
      throw new UpstreamError(body?.errorMsg ?? '上游服务调用失败');
    }
    if (res.status === 404) {
      throw new NotFoundError(body?.errorMsg ?? '资源未找到');
    }
    throw new ApiError(body?.errorMsg ?? '未知错误', res.status);
  }

  const envelope = await res.json();
  if (envelope.status !== 0) {
    throw new ApiError(envelope.errorMsg ?? '业务错误', envelope.status);
  }
  return envelope.data as T;
}
```

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

## 11. 附录：character_overrides 用法

LLM 分析结果：

```jsonc
[
  { "name": "林远", "gender": "male", "age": "二十二岁", "voice_description": "清亮的青年男声", ... },
  { "name": "苏晴", "gender": "female", "age": "十九岁", "voice_description": "清脆的少女声", ... }
]
```

用户在 UI 上只修改了林远的声音描述和年龄，传给 convert 时：

```jsonc
POST /novel/convert
{
  "novel_title": "星辰大海",
  "chapters": [...],
  "character_overrides": {
    "林远": {
      "voice_description": "成熟稳重的三十岁男声，略带沙哑",
      "age": "三十岁"
    }
  }
}
```

后端合并逻辑：

```
LLM 结果 → character_descriptions → character_overrides → 最终画像
                                                     ↑
                                              只传要改的字段
```
