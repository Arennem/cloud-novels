# API 参考

> 全部接口定义、请求/响应示例、Zod Schema

---

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/tts` | 单段文本合成（流式返回音频） |
| POST | `/novel/convert` | 批量合成整部小说 |
| GET | `/novels` | 列出所有已注册的小说 |
| GET | `/novels/:novelId` | 查询某部小说详情 |
| DELETE | `/novels/:novelId` | 删除小说及其角色声音 |
| GET | `/characters` | 列出所有角色声音 |
| GET | `/novels/:novelId/characters` | 列出某部小说的角色 |
| DELETE | `/novels/:novelId/characters/:roleName` | 删除角色声音 |
| GET | `/voices` | 查询可用音色列表 |
| GET | `/health` | 健康检查 |

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
  "task_id": "a1b2c3d4-e5f6-...",            // 合成任务 ID
  "status": "completed",                     // pending | processing | completed | failed
  "novel_id": "b2c3d4e5-f6a7-...",          // 小说内部 UUID
  "chapters": [
    {
      "title": "第一章 相遇",
      "duration_seconds": 180,
      "url": "/output/chapter_1.mp3"
    }
  ],
  "characters_registered": ["林远", "苏晴"],  // 本次注册的角色
  "character_analysis": [                     // 大模型分析的角色画像
    { "name": "林远", "gender": "male",   "voice_description": "低沉浑厚的青年男声" },
    { "name": "苏晴", "gender": "female", "voice_description": "清脆悦耳的少女声" }
  ]
}
```

### Zod Schema

```ts
export const ChapterSchema = z.object({
  title:   z.string().min(1, '章节标题不能为空'),
  content: z.string().min(1, '章节内容不能为空'),
  voice:   z.string().optional(),
  roles:   z.record(z.string()).optional(),
});

export const NovelRequestSchema = z.object({
  chapters:      z.array(ChapterSchema).min(1, '至少需要一章'),
  output_format: AudioFormat.default('mp3'),
  merge:         z.boolean().default(false),
  character_descriptions: z.record(z.string()).optional(),
}).extend({
  novel_title: z.string().min(1, '小说名称必填'),
});
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

### Zod Schema

```ts
export const TtsRequestSchema = z.object({
  text:     z.string().min(1).max(500),
  voice:    z.string().default('longxiaochun'),
  speed:    z.number().min(0.5).max(2.0).default(1.0),
  format:   z.enum(['wav', 'mp3', 'pcm']).default('mp3'),
  emotion:  z.enum(['happy', 'sad', 'angry', 'surprise', 'calm', 'default']).optional(),
});
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

### GET /novels/:novelId

```jsonc
// Response
{
  "id": "a1b2c3d4-...",
  "title": "星辰大海",
  "created_at": "2026-07-05T12:00:00Z",
  "updated_at": "2026-07-05T12:00:00Z"
}

// 404
{ "error": "小说未找到" }
```

### DELETE /novels/:novelId

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
// Response
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

### GET /novels/:novelId/characters

同上，但只返回指定小说的角色。

### DELETE /novels/:novelId/characters/:roleName

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
// Response
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
// Response
{
  "status": "ok",
  "timestamp": "2026-07-05T12:00:00Z",
  "novels_count": 3,
  "speakers_count": 7
}
```

