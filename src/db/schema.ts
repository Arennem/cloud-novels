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
CREATE TABLE IF NOT EXISTS novel_chapters (
  id         TEXT PRIMARY KEY,
  novel_id   TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_novel_chapters_novel ON novel_chapters(novel_id);

`;

export const MALE_VOICES   = ['longfei', 'longchuan', 'longgang', 'longyu', 'xiaofeng', 'longshuo'];
export const FEMALE_VOICES = ['longmiao', 'longhua', 'longyao', 'longxiaochun'];
export const ALL_VOICES    = [...MALE_VOICES, ...FEMALE_VOICES];

/** 旁白角色名及固定音色，不经过大模型分析和 CosyVoice speaker 注册 */
export const NARRATION_ROLE_NAME = '旁白';
export const NARRATION_VOICE     = 'longxiaochun';

