# Routes 目录说明

本文档说明了 `src/routes/` 下各路由文件的划分方式、接口入参/反参的约定、新增接口的位置以及注意事项。

---

## 目录划分

每个 `.ts` 文件对应一组功能相关接口，通过 Fastify `register` 注册到 app 实例。文件按**功能域**拆分，而不是按 HTTP 方法或实体拆分。

| 文件 | 路由前缀 / 路径 | 职责 |
|---|---|---|
| `health.ts` | `GET /health` | 系统健康检查，返回小说数、角色数概览 |
| `novel.ts` | `/novel`, `/novels` | 小说 CRUD：上传文本并解析章节、列表/详情、删除 |
| `novel-analyze.ts` | `/novel/analyze`, `/novel/upload-and-analyze` | LLM 角色分析（不含语音合成），支持一站式上传+分析 |
| `novel-convert.ts` | `/novel/convert`, `/novel/synthesize`, `/task/:id`, `/tasks` | 异步合成任务：提交完整合成、按需合成、查询任务进度和列表 |
| `novel-speaker.ts` | `/characters`, `/novel/speakers/register`, `/novel/speakers/regenerate` | 角色 Speaker 管理：列表/详情/删除/更新画像、注册和重新生成声音 |
| `novel-audio.ts` | `/novel/audio`, `/novel/audio/chapter` | 音频缓存记录查询，支持按小说和章节标题过滤 |
| `notifications.ts` | `/notifications` | 通知管理：分页列表、标记已读（单条/全部） |
| `tts.ts` | `POST /tts` | 单段文本直接 TTS 合成，不经过角色分析管线 |
| `voices.ts` | `GET /voices` | 内置基础音色列表分页查询 |

> 接口以 `GET` 查询、`POST` 写操作为主，不使用 PUT / PATCH / DELETE 动词。

---

## 新增接口 —— 加在哪里

### 基本原则

- **同功能放同文件**：新接口属于哪个功能域就加在哪个文件的 `export async function xxxRoutes` 函数中。
- **功能域无归属才新建文件**：如果新接口不属于上述任何一个文件，才新建 `.ts` 文件，并在 `src/app.ts` 中 `register`。
- **按域分组，不按实体拆分**：不要因为一个实体有增删改查就单开一个文件；除非该实体逻辑足够复杂（如 `characters` 已经合并在 `novel-speaker.ts` 中）。

### 判断示例

| 新接口 | 应该加在哪 |
|---|---|
| 新增一种"导出章节"的功能 | `novel.ts`（小说相关） |
| 增加音色试听接口 | `voices.ts` 或 `tts.ts` |
| 需要按时间范围筛选通知 | `notifications.ts` |
| 增加批量删除角色 | `novel-speaker.ts` |
| 查询 AI 分析进度（而非任务） | 视情况，可新建或归入 `novel-analyze.ts` |

---

## 接口入参 / 反参规则

### 1. 入参：两层校验

每一层服务于不同的目的：

| 层 | 文件位置 | 用途 | 示例 |
|---|---|---|---|
| **Zod Schema** | `src/schemas/*.ts` | 运行时类型校验、错误消息 | `NovelQuerySchema`、`PaginatedSchema` |
| **Route Schema** | `src/route-schemas/*.ts` | Swagger 文档描述、路由元信息 | `novelListSchema`、`novelDetailSchema` |

- Zod Schema 通过 `request.query` / `request.body` / `request.params` 拿到原始值后手动 `.parse()`。
- Route Schema 通过 Fastify `schema` 选项自动生成 OpenAPI 文档，不做运行时校验。
- 两者都需要添加，缺一不可。

### 2. 反参：统一封装的 ApiResponse

所有响应必须通过 `src/utils/response.ts` 中的函数包装：

```ts
import { success, fail, paginated } from "../utils/response.js";

// 成功
return success({ novel_id: "xxx", title: "xx" });
// 失败
return reply.status(404).send(fail("小说未找到", 404));
// 分页
return success({ novels: paginated(list, total, pageNum, pageSize) });
```

返回结构：

```json
{
  "status": 0,
  "data": { ... },
  "errorMsg": null,
  "timestamp": "2026-07-10 14:30:00",
  "traceId": "uuid"
}
```

- `status === 0` 表示成功，非零表示失败。
- `data` 内部再包装具体业务字段，不直接用数组或简单值做顶层 data。
- 错误时 `data: null`，`errorMsg` 为人类可读的错误描述。

### 3. 分页约定

分页参数统一从 `PaginationSchema`（`src/schemas/common.schema.ts`）解析：

```ts
const { pageNum, pageSize } = PaginationSchema.parse(request.query);
// pageNum: number, 默认 1, 最小 1
// pageSize: number, 默认 10, 最小 1, 最大 50
```

分页响应统一使用 `paginated()` 函数包装：

```ts
paginated(list, total?, pageNum, pageSize)
// → { total: number, pageNum: number, pageSize: number, list: T[] }
```

### 4. HTTP 状态码

| 场景 | 状态码 | 说明 |
|---|---|---|
| 正常返回 | 200 | 不搞 201 / 204 等变体 |
| 资源不存在 | 404 | `reply.status(404).send(fail(...))` |
| 参数错误 | 400 | `reply.status(400).send(fail(...))` |
| 不可处理的请求 | 422 | 无 content 字段 |
| 上游服务失败 | 502 | TTS 服务调用等 |
| 服务内部错误 | 500 | 不主动使用，由框架兜底 |

---

## 注意事项

### Zod Schema 编写规范

- 查询参数（query string）一律用 `z.coerce.number()` 做类型转换（因为 query string 全是字符串）。
- body 参数使用 `z.string().min(1)` / `z.number()` 等原生类型。
- 使用 `.refine()` 做跨字段校验（如 `novel_id` 或 `novel_title` 至少提供一个）。
- 所有字段写 `.describe()` 做中文描述，便于追溯。

### Route Schema 编写规范

- 使用 `routeSchema()` 包装（`src/swagger-helper.ts`），填写 `tags`、`summary`、`description`。
- `tags` 必须与已有 tag 一致：`"system"`、`"novel"`、`"character"`、`"voice"`、`"tts"`。
- `response` 中的 `data` 结构只需描述 `data` 内部字段，不需要包裹 `status / timestamp / traceId`。
- 如果接口返回的是二进制流（如 TTS 的音频），response 只写 `description` 即可，不需要写 `data`。

### 异步任务约定

- `/novel/convert` 和 `/novel/synthesize` 提交后立即返回 `task_id`，不阻塞等待。
- 客户端通过 `GET /task/:id` 轮询任务状态（`pending` → `processing` → `completed` / `failed`）。
- 任务实体在 `task_manager.ts` 中管理，不要绕过它直接写 DB。

### 其他约束

- `novel.schema.ts` 中的 `AnalyzeRequestSchema.chapters` 字段结构是 `{title, content}`，不要写成 `{chapter_title, chapter_content}` 等别名。
- `registerSpeakersRoute` 依赖 `novelManager.getChapters()` 获取已有章节，缺少章节时会返回 404。
- 所有写操作接口使用 `POST`，查询类接口使用 `GET`。不使用 `DELETE` / `PUT` / `PATCH`。
- `.js` 后缀在 import 中必须带（TS 编译到 ESM 后的硬性要求）。

### 文件位置一览

```
src/
├── routes/                  ← 接口逻辑（本目录）
│   ├── health.ts
│   ├── novel.ts
│   ├── novel-analyze.ts
│   ├── novel-audio.ts
│   ├── novel-convert.ts
│   ├── novel-speaker.ts
│   ├── notifications.ts
│   ├── tts.ts
│   └── voices.ts
├── route-schemas/           ← 路由的 Schema 定义（Swagger 文档）
│   ├── health.schema.ts
│   ├── novel.schema.ts
│   ├── novel-analyze.schema.ts
│   ├── ...
│   └── index.ts             ← barrel export
├── schemas/                 ← Zod 运行时校验 Schema
│   ├── common.schema.ts
│   ├── novel.schema.ts
│   ├── character.schema.ts
│   ├── tts.schema.ts
│   └── voice.schema.ts
└── ...
```
