# 数据库设计

> SQLite 数据库表结构、约束、索引、配置说明

---

## 总览

使用 SQLite（better-sqlite3）单文件数据库，路径由 `DB_PATH` 控制，默认 `./data/cloud-novels.db`。

---

## 表结构

### novels — 小说表

```sql
CREATE TABLE novels (
  id         TEXT PRIMARY KEY,          -- UUID
  title      TEXT NOT NULL,             -- 小说名（业务键，UNIQUE）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### speakers — 角色声音表

```sql
CREATE TABLE speakers (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  role_name   TEXT NOT NULL,
  base_voice  TEXT NOT NULL,
  description TEXT,                     -- voice_description 的快捷字段
  portrait    TEXT,                     -- 大模型分析得到的完整角色画像（JSON）
  speaker_id  TEXT NOT NULL,            -- DashScope speaker 引用
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(novel_id, role_name)           -- 同一小说内角色名唯一
);
```

| 字段 | 说明 |
|---|---|
| `portrait` | 大模型分析得到的角色完整画像，JSON 格式存储，含性别/年龄/身高/体态/性格/声线描述等 |
| `description` | `portrait.voice_description` 的快捷字段，可直接查询使用 |

### synthesis_jobs — 合成任务表

```sql
CREATE TABLE synthesis_jobs (
  id                 TEXT PRIMARY KEY,
  novel_id           TEXT NOT NULL REFERENCES novels(id),
  status             TEXT NOT NULL DEFAULT 'pending',
  total_chapters     INTEGER NOT NULL DEFAULT 0,
  completed_chapters INTEGER NOT NULL DEFAULT 0,
  output_format      TEXT NOT NULL DEFAULT 'mp3',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
```

### chapters — 章节音频结果表

```sql
CREATE TABLE chapters (
  id               TEXT PRIMARY KEY,
  job_id           TEXT NOT NULL REFERENCES synthesis_jobs(id),
  title            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  duration_seconds REAL,
  output_path      TEXT,
  sort_order       INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);
```

---

## 约束汇总

```
novels.title                           → UNIQUE
speakers (novel_id, role_name)         → UNIQUE + FK → novels.id CASCADE
synthesis_jobs.novel_id                → FK → novels.id
chapters.job_id                        → FK → synthesis_jobs.id
```

---

## SQLite 配置

```ts
db.pragma('journal_mode = WAL');     // 并发读写
db.pragma('foreign_keys = ON');      // 级联删除
```

---

## FAQ

**Q：novel_title 重复怎么办？**

同名映射到同一部小说。需要区分可传复合标题如 `"星辰大海（张三）"`。

**Q：portrait 字段存的是什么？**

大模型（通义千问）分析后返回的 JSON，包含角色的性别、年龄、身高、体态、性格、声线描述等结构化数据。用于指导 CosyVoice 生成更贴合角色的声音。

**Q：数据库文件可以迁移吗？**

直接拷贝 `data/cloud-novels.db` 即可完整迁移。
