# Cloud Novels

> 小说文本转语音微服务 — 基于 Fastify + Zod + SQLite + 阿里云百炼 CosyVoice

---

## 是什么

接收小说文本，AI 自动为每个角色生成独特声音，输出可播放的有声书音频。

**一句话**：传小说文本进来，还你一部有声书。

---

## 快速开始

```bash
# 安装
pnpm install

# 配置（填入阿里云百炼 API Key）
cp .env.example .env

# 启动
pnpm dev
```

服务默认运行在 `http://localhost:3000`。

---

## 核心流程

```
小说文本（带角色标记）
    │
    ▼
自动扫描角色 → 为每个角色 AI 生成声音
    │
    ▼
按角色逐句合成 → 拼接 → 输出章节音频
```

---

## 核心设计原则

| 原则 | 说明 |
|---|---|
| **小说标题作为业务键** | 客户端传 `novel_title`，服务端映射到稳定 UUID，同一标题永远指向同一 ID |
| **角色声音按小说隔离** | 不同小说里的同名角色互不干扰，各自有独立声音 |
| **一次生成，永久一致** | 角色声音首次生成后持久化到 SQLite，后续请求直接复用 |
| **Zod 单一真实来源** | Schema 同时管运行时校验 + 编译时类型 + API 文档生成 |

---

## 目录结构

```
src/
├── app.ts                   # Fastify 入口 + 全部路由注册
├── config.ts                # 环境变量（Zod 校验）
├── db/
│   ├── index.ts             # SQLite 连接管理
│   └── schema.ts            # 建表 SQL + 常量
├── routes/
│   ├── tts.ts               # POST /tts
│   ├── novel.ts             # POST /novel/convert
│   └── voices.ts            # GET /voices
├── services/
│   ├── cosyvoice.ts         # DashScope API 封装
│   ├── novel_manager.ts     # 小说 CRUD + 标题映射
│   ├── speaker_manager.ts   # 角色声音注册与缓存
│   ├── text_splitter.ts     # 文本分片 + 角色提取
│   └── audio_merger.ts      # 音频拼接
├── schemas/                 # Zod Schema
│   ├── common.schema.ts
│   ├── config.schema.ts
│   ├── tts.schema.ts
│   ├── novel.schema.ts
│   └── voice.schema.ts
├── types/index.ts            # 从 Schema 自动派生
└── utils/
    ├── logger.ts
    └── file.ts
```

---

## 技术栈

| 层级 | 选型 |
|---|---|
| **框架** | Fastify 5.x |
| **语言** | TypeScript 5.x（严格模式） |
| **校验** | Zod 3.x |
| **数据库** | SQLite（better-sqlite3） |
| **TTS API** | 阿里云百炼 DashScope（CosyVoice） |
| **音频拼接** | fluent-ffmpeg |
| **测试** | Vitest |

---

## 相关文档

| 文档 | 内容 |
|---|---|
| [架构总览](architecture.md) | 系统架构图、核心职责 |
| [API 参考](api.md) | 全部接口定义、请求/响应示例 |
| [数据库设计](database.md) | 表结构、约束、索引、FAQ |
| [数据流](data-flow.md) | 标题映射、角色声音一致性、合成流程 |
