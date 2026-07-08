# API 参考

> 全部接口定义、请求/响应示例、Zod Schema

---

## 接口一览

| 方法 | 路径 | 传参方式 | 说明 |
|---|---|---|---|
| POST | `/tts` | JSON body | 单段文本合成（流式返回音频） |
| POST | `/novel/upload` | JSON / multipart | 上传原始文本，自动拆分章节 |
| POST | `/novel/analyze` | JSON body | 只分析角色画像，不合成语音 |
| POST | `/novel/convert` | JSON body | 完整流程：分析 → 注册声音 → 合成 |
| POST | `/novel/delete` | JSON body | 删除小说及其角色声音 |
| POST | `/characters/delete` | JSON body | 删除角色声音 |
| GET | `/novels` | — | 列出所有已注册的小说 |
| GET | `/novel` | query `?id=xxx` | 查询某部小说详情 |
| GET | `/characters` | query `?novel_id=xxx` 可选 | 列出角色（不带参则全部） |
| GET | `/voices` | — | 查询可用音色列表 |
| GET | `/health` | — | 健康检查 |

---

## 典型工作流

```
上传文本 → 获得章节列表 → 预览角色画像 → 修改/确认 → 完整合成
    ①                 ②                   ③
```

> ① `POST /novel/upload`
> ② `POST /novel/analyze`
> ③ `POST /novel/convert`

---

## POST /novel/upload

上传原始小说文本，由服务端按章节标题自动拆分。支持两种传参方式。

### JSON body

```jsonc
{
  "novel_title": "星辰大海",       // string, 必填
  "content": "第一章 相遇\n日落西山。\n[林远]你到底是谁？\n\n第二章 真相\n[苏晴]我不会告诉你的。"
}
```

### multipart/form-data (文件上传)

| 字段 | 类型 | 说明 |
|---|---|---|
| `novel_title` | text | 小说名称 |
| `file` | file | .txt 文件，UTF-8 编码，上限 50MB |

### 支持自动识别的章节标题格式

- `第X章 [标题]`（中文数字或阿拉伯数字）
- `第X节` / `第X部` / `第X集`
- `# 标题` / `## 标题`（Markdown 标题）
- 找不到标题时整篇作为 "正文" 一章

### Response

```jsonc
{
  "novel_title": "星辰大海",
  "chapters": [
    { "title": "第一章 相遇", "content": "日落西山。\n[林远]你到底是谁？" },
    { "title": "第二章 真相", "content": "[苏晴]我不会告诉你的。" }
  ],
  "chapter_count": 2
}
```

---

## POST /novel/analyze

只执行大模型角色分析，**不进行语音合成**。适合在合成前预览角色画像，确认后再调 `/novel/convert`。

### Request

```jsonc
{
  "novel_title": "星辰大海",                           // string, 必填
  "chapters": [                                        // array, 至少一章
    {
      "title": "第一章 相遇",
      "content": "日落西山。\n[林远]你到底是谁？\n[苏晴]我不会告诉你的。"
    }
  ],
  "character_descriptions": {                          // object, 可选
    "林远": "二十二岁青年，沉稳果断",
    "苏晴": "十九岁少女，活泼俏皮"
  }
}
```

### Response

```jsonc
{
  "characters": [
    {
      "name": "林远",
      "gender": "male",
      "age": "二十二岁",
      "height": "178cm",
      "build": "健壮",
      "personality": ["沉稳", "果断"],
      "voice_description": "低沉浑厚的青年男声，略带磁性，语气沉稳有力",
      "speaking_style": "语速中等，吐字清晰，说话干脆利落",
      "backstory_summary": "小说主角，出身平凡但胸怀大志的年轻人..."
    }
  ],
  "character_count": 2
}
```

> 返回每个角色的完整画像，供你在合成前审查或手动调整。如需修改，可在 `/novel/convert` 的 `character_descriptions` 中补充。

---

## POST /novel/convert

批量合成整部小说。`novel_title` 作为业务键，同一标题始终映射到同一 `novel_id`。

### Request

```jsonc
{
  "novel_title": "星辰大海",                           // string, 必填
  "chapters": [                                        // array, 至少一章
    {
      "title": "第一章 相遇",                           // string, 必填
      "content": "日落西山。\n[林远]你到底是谁？\n[苏晴]我不会告诉你的。"  // string, 必填
    }
  ],
  "character_descriptions": {                          // object, 可选
    "林远": "二十二岁青年，沉稳果断",
    "苏晴": "十九岁少女，活泼俏皮"
  },
  "output_format": "mp3",                              // "wav" | "mp3" | "pcm"
  "merge": false                                       // 是否合并为一整个音频
}
```

### Response

```jsonc
// 200
{
  "task_id": "a1b2c3d4-e5f6-...",
  "status": "completed",
  "novel_id": "b2c3d4e5-f6a7-...",
  "chapters": [
    {
      "title": "第一章 相遇",
      "duration_seconds": 180,
      "url": "/output/chapter_1.mp3"
    }
  ],
  "characters_registered": ["林远", "苏晴"],
  "character_analysis": [
    { "name": "林远", "gender": "male",   "voice_description": "低沉浑厚的青年男声" },
    { "name": "苏晴", "gender": "female", "voice_description": "清脆悦耳的少女声" }
  ]
}
```

---

## POST /tts

实时合成单段文本，流式返回音频。

### Request

```jsonc
{
  "text":     "这是一个测试文本。",           // string, 1-500 字
  "voice":    "longxiaochun",                // string, 默认音色
  "speed":    1.0,                           // number, 0.5-2.0
  "format":   "mp3",                         // "wav" | "mp3" | "pcm"
  "emotion":  "happy"                        // 可选: happy|sad|angry|surprise|calm|default
}
```

### Response

```
200
Content-Type: audio/mpeg  (或 audio/wav / audio/l16)

// 音频二进制流
```

---

## 小说管理

### GET /novels

```jsonc
// Response
{
  "novels": [
    {
      "id": "a1b2c3d4-...",
      "title": "星辰大海",
      "created_at": "2026-07-05T12:00:00Z",
      "updated_at": "2026-07-05T12:00:00Z"
    }
  ]
}
```

### GET /novel

```jsonc
// 200
{ "id": "a1b2c3d4-...", "title": "星辰大海", "created_at": "...", "updated_at": "..." }

// 404
{ "error": "小说未找到" }
```

### POST /novel/delete

```jsonc
// 200
{ "status": "deleted", "novel_id": "a1b2c3d4-..." }

// 404
{ "error": "小说未找到" }
```

> 级联删除：删除小说时会自动删除该小说下所有角色声音。

---

## 角色声音管理

### GET /characters

```jsonc
{
  "characters": [
    {
      "id": "spk-xxx",
      "novelId": "a1b2c3d4-...",
      "roleName": "林远",
      "baseVoice": "longfei",
      "description": "沉稳果断的青年",
      "speakerId": "speaker-abc",
      "createdAt": "2026-07-05T12:00:00Z",
      "updatedAt": "2026-07-05T12:00:00Z"
    }
  ]
}
```

### GET /characters

同上，但只返回指定小说的角色。

### POST /characters/delete

```jsonc
// 200
{ "status": "deleted", "roleName": "林远" }

// 404
{ "error": "角色未找到" }
```

> 删除后，再次合成时该角色会重新生成新声音。

---

## GET /voices

查询 CosyVoice 预置音色列表。

```jsonc
{
  "voices": [
    { "id": "longfei",     "name": "龙飞",   "gender": "male",   "style": "成熟稳重", "language": "zh-CN" },
    { "id": "longchuan",   "name": "龙川",   "gender": "male",   "style": "清新自然", "language": "zh-CN" },
    { "id": "longgang",    "name": "龙港",   "gender": "male",   "style": "温暖亲切", "language": "zh-CN" },
    { "id": "longyu",      "name": "龙雨",   "gender": "male",   "style": "明亮",     "language": "zh-CN" },
    { "id": "xiaofeng",    "name": "晓峰",   "gender": "male",   "style": "阳光",     "language": "zh-CN" },
    { "id": "longmiao",    "name": "龙妙",   "gender": "female",  "style": "温柔甜美", "language": "zh-CN" },
    { "id": "longhua",     "name": "龙华",   "gender": "female",  "style": "自然亲切", "language": "zh-CN" },
    { "id": "longyao",     "name": "龙瑶",   "gender": "female",  "style": "知性",     "language": "zh-CN" },
    { "id": "longshuo",    "name": "龙硕",   "gender": "male",   "style": "厚重沉稳", "language": "zh-CN" },
    { "id": "longxiaochun","name": "龙小春", "gender": "female",  "style": "活泼",     "language": "zh-CN" }
  ]
}
```

---

## GET /health

```jsonc
{
  "status": "ok",
  "timestamp": "2026-07-05T12:00:00Z",
  "novels_count": 3,
  "speakers_count": 7
}
```





