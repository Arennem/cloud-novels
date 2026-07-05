# 架构总览

> 大局图、核心职责、与外部系统的关系

---

## 系统架构图

```
┌─────────────┐     ┌──────────────────────────────────┐     ┌──────────────┐
│  客户端/UI   │────▶│      Novel TTS Service           │────▶│  DashScope   │
│ (传 novel_title)│◀────│         (Fastify)               │◀────│ CosyVoice API│
└─────────────┘     └──────────────────────────────────┘     └──────────────┘
                              │
                              ▼
                     ┌──────────────────────┐
                     │    SQLite 数据库      │
                     │  data/cloud-novels.db │
                     │  ├─ novels            │  ← 小说标题 → UUID 映射
                     │  ├─ speakers          │  ← 角色声音（按 novel_id 隔离）
                     │  ├─ synthesis_jobs    │  ← 合成任务记录
                     │  └─ chapters          │  ← 章节音频结果
                     └──────────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │  output/ 音频文件  │
                     │  (mp3 / wav)     │
                     └──────────────────┘
```

---

## 核心职责

- 接收小说文本，支持**单段合成**和**批量章节合成**
- 客户端只需传 `novel_title`，服务端自动映射到稳定 `novel_id`
- 同一标题始终映射到同一 ID，**角色声音跨请求一致**
- 自动扫描角色，**AI 生成独特声音**并持久化到 SQLite
- 输出为音频文件（WAV / MP3），支持流式返回

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DASHSCOPE_API_KEY` | — | 阿里云百炼 API Key |
| `PORT` | 3000 | 服务端口 |
| `DB_PATH` | ./data/cloud-novels.db | SQLite 数据库路径 |
| `DEFAULT_VOICE` | longxiaochun | 默认（旁白）音色 |
| `MAX_TEXT_LENGTH` | 500 | 单次合成最大字数 |

---

## 目录结构

```
src/
├── app.ts                   # Fastify 入口 + 全部路由注册
├── config.ts                # 环境变量（Zod 校验）
├── db/
│   ├── index.ts             # SQLite 连接管理（WAL 模式 + FK）
│   └── schema.ts            # 建表 SQL + 音色池常量
├── routes/
│   ├── tts.ts               # POST /tts
│   ├── novel.ts             # POST /novel/convert, GET /novels
│   └── voices.ts            # GET /voices
├── services/
│   ├── cosyvoice.ts         # DashScope API 封装
│   ├── novel_manager.ts     # 小说 CRUD + 标题 → ID 映射
│   ├── speaker_manager.ts   # 角色声音注册与缓存
│   ├── text_splitter.ts     # 文本分片 + 角色提取
│   └── audio_merger.ts      # 音频拼接
├── schemas/                 # Zod Schema（单一真实来源）
│   ├── common.schema.ts
│   ├── config.schema.ts
│   ├── tts.schema.ts
│   ├── novel.schema.ts
│   └── voice.schema.ts
├── types/index.ts           # 从 Schema 自动派生
└── utils/
    ├── logger.ts
    └── file.ts
```

---

## 相关文档

| 文档 | 内容 |
|---|---|
| [项目总览](README.md) | 是什么、快速开始、目录结构 |
| [API 参考](api.md) | 全部接口定义、请求/响应示例 |
| [数据库设计](database.md) | 表结构、约束、索引、FAQ |
| [数据流](data-flow.md) | 标题映射、角色声音一致性、合成流程 |
