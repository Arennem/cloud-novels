import { MALE_VOICES, FEMALE_VOICES, ALL_VOICES, NARRATION_ROLE_NAME, NARRATION_VOICE } from '../constants/index.js';
export { MALE_VOICES, FEMALE_VOICES, ALL_VOICES, NARRATION_ROLE_NAME, NARRATION_VOICE };

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS novels (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS speakers (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  role_name   TEXT NOT NULL,
  base_voice  TEXT NOT NULL,
  description TEXT,
  portrait    TEXT,
  speaker_id  TEXT NOT NULL,
  sample_audio_path TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(novel_id, role_name)
);
CREATE INDEX IF NOT EXISTS idx_speakers_novel ON speakers(novel_id);

CREATE TABLE IF NOT EXISTS synthesis_jobs (
  id                 TEXT PRIMARY KEY,
  novel_id           TEXT NOT NULL REFERENCES novels(id),
  status             TEXT NOT NULL DEFAULT 'pending',
  total_chapters     INTEGER NOT NULL DEFAULT 0,
  completed_chapters INTEGER NOT NULL DEFAULT 0,
  output_format      TEXT NOT NULL DEFAULT 'mp3',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id               TEXT PRIMARY KEY,
  job_id           TEXT NOT NULL REFERENCES synthesis_jobs(id),
  title            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  duration_seconds REAL,
  output_path      TEXT,
  sort_order       INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audio_cache (
  id            TEXT PRIMARY KEY,
  novel_id      TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_title TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  format        TEXT NOT NULL DEFAULT 'mp3',
  file_path     TEXT NOT NULL,
  duration_seconds REAL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audio_cache_novel ON audio_cache(novel_id, chapter_title);

CREATE TABLE IF NOT EXISTS synthesis_tasks (
  id                 TEXT PRIMARY KEY,
  novel_id           TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  task_type          TEXT NOT NULL DEFAULT 'convert',   -- 'convert' | 'synthesize'
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending / processing / completed / partial / failed
  output_format      TEXT NOT NULL DEFAULT 'mp3',
  merge              INTEGER NOT NULL DEFAULT 0,
  total_chapters     INTEGER NOT NULL DEFAULT 0,
  completed_chapters INTEGER NOT NULL DEFAULT 0,
  failed_chapters    INTEGER NOT NULL DEFAULT 0,
  merged_url         TEXT,
  characters_registered TEXT,  -- JSON: string[]
  character_analysis    TEXT,  -- JSON: analysis[]
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_synthesis_tasks_novel ON synthesis_tasks(novel_id, created_at);

CREATE TABLE IF NOT EXISTS task_chapters (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL REFERENCES synthesis_tasks(id) ON DELETE CASCADE,
  chapter_title    TEXT NOT NULL,
  sort_order       INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending / annotating / synthesizing / merging / completed / failed / cached
  output_url       TEXT,
  duration_seconds REAL,
  error_message    TEXT,
  segment_count    INTEGER,
  content_hash     TEXT,
  started_at       TEXT,
  completed_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_chapters_task ON task_chapters(task_id);

CREATE TABLE IF NOT EXISTS annotation_jobs (
  id                   TEXT PRIMARY KEY,
  novel_id             TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_title        TEXT NOT NULL,
  content_hash         TEXT NOT NULL,

  -- Annotation state machine
  annotation_status    TEXT NOT NULL DEFAULT 'pending',  -- pending / processing / done / failed
  annotation_data      TEXT,   -- JSON: ScriptSegment[]
  annotation_error     TEXT,   -- error message if failed
  annotation_attempts  INTEGER NOT NULL DEFAULT 0,
  annotation_started_at TEXT,
  annotation_completed_at TEXT,

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(novel_id, chapter_title, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_annotation_jobs_novel ON annotation_jobs(novel_id, chapter_title);

CREATE TABLE IF NOT EXISTS novel_chapters (
  id         TEXT PRIMARY KEY,
  novel_id   TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_novel_chapters_novel ON novel_chapters(novel_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  novel_id   TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  task_id    TEXT,
  type       TEXT NOT NULL,     -- task_completed / task_failed / task_partial / chapter_completed / chapter_failed / chapter_cached
  title      TEXT NOT NULL,     -- 通知标题，如"《三体》合成完成"
  message    TEXT,              -- 通知正文，如"12章已合成，2章失败"
  data       TEXT,              -- JSON 附加数据
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_novel ON notifications(novel_id, is_read, created_at);

`;
