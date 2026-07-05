import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema.js';

describe('Database schema', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
  });

  afterAll(() => {
    db.close();
  });

  it('should create novels table and insert a novel', () => {
    db.prepare('INSERT INTO novels (id, title) VALUES (?, ?)').run('novel-1', '测试小说');
    const row = db.prepare('SELECT * FROM novels WHERE id = ?').get('novel-1') as any;
    expect(row.title).toBe('测试小说');
  });

  it('should create speakers table with novel FK constraint', () => {
    db.prepare(`
      INSERT INTO speakers (id, novel_id, role_name, base_voice, speaker_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('spk-1', 'novel-1', '林远', 'longfei', 'speaker-abc');

    const row = db.prepare('SELECT * FROM speakers WHERE role_name = ?').get('林远') as any;
    expect(row.base_voice).toBe('longfei');
  });

  it('should enforce unique novel_id + role_name', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO speakers (id, novel_id, role_name, base_voice, speaker_id)
        VALUES (?, ?, ?, ?, ?)
      `).run('spk-2', 'novel-1', '林远', 'longhua', 'speaker-def');
    }).toThrow();
  });

  it('should allow same role name in different novels', () => {
    db.prepare('INSERT INTO novels (id, title) VALUES (?, ?)').run('novel-2', '另一本小说');
    db.prepare(`
      INSERT INTO speakers (id, novel_id, role_name, base_voice, speaker_id)
      VALUES (?, ?, ?, ?, ?)
    `).run('spk-3', 'novel-2', '林远', 'longhua', 'speaker-xyz');

    const row = db.prepare(
      'SELECT * FROM speakers WHERE novel_id = ? AND role_name = ?'
    ).get('novel-2', '林远') as any;
    expect(row.base_voice).toBe('longhua');
  });

  it('should cascade delete speakers when novel is deleted', () => {
    db.prepare('DELETE FROM novels WHERE id = ?').run('novel-2');
    const count = db.prepare('SELECT COUNT(*) as c FROM speakers WHERE novel_id = ?').get('novel-2') as any;
    expect(count.c).toBe(0);
  });
});
