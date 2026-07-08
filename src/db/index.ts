import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { SCHEMA_SQL } from './schema.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function initDb(dbPath?: string): Database.Database {
  const path = resolve(dbPath ?? config.DB_PATH ?? './data/cloud-novels.db');

  // 确保目录存在
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(path);

  // 启用 WAL 模式（更好的并发性能）
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 初始化表结构
  db.exec(SCHEMA_SQL);

  logger.info('数据库已初始化', { path });
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    logger.info('数据库已关闭');
  }
}
