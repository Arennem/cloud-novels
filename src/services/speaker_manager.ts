import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { cosyvoiceService } from './cosyvoice.js';
import { characterAnalyzer } from './character_analyzer.js';
import { MALE_VOICES, FEMALE_VOICES, ALL_VOICES, NARRATION_ROLE_NAME, NARRATION_VOICE } from '../db/schema.js';
import type { CharacterPortrait } from '../schemas/character.schema.js';

interface SpeakerRow {
  id: string;
  novel_id: string;
  role_name: string;
  base_voice: string;
  description: string | null;
  portrait: string | null;
  speaker_id: string;
  created_at: string;
  updated_at: string;
}

export interface SpeakerProfile {
  id: string;
  novelId: string;
  roleName: string;
  baseVoice: string;
  description: string | null;
  portrait: CharacterPortrait | null;
  speakerId: string;
  createdAt: string;
  updatedAt: string;
}

export class SpeakerManager {
  /** 跨实例共享 voiceIndex，保证 base voice 轮询不重复 */
  private static globalVoiceIndex = 0;
  private inMemoryCache = new Map<string, SpeakerProfile>();

  private cacheKey(novelId: string, roleName: string): string {
    return `${novelId}::${roleName}`;
  }

  /**
   * 获取或创建角色声音
   * - "旁白" 走固定音色，不调用 CosyVoice
   * - 其他角色：首次调 CosyVoice 生成 speaker，之后复用
   */
  async getOrCreateSpeaker(novelId: string, roleName: string, portrait?: CharacterPortrait): Promise<SpeakerProfile> {
    // ── 旁白：固定音色，不调 CosyVoice ──
    if (roleName === NARRATION_ROLE_NAME) {
      return this._getOrCreateNarration(novelId);
    }

    // ── 普通角色 ──
    const key = this.cacheKey(novelId, roleName);

    // 1. 内存缓存
    const cached = this.inMemoryCache.get(key);
    if (cached) return cached;

    // 2. 数据库查询
    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM speakers WHERE novel_id = ? AND role_name = ?'
    ).get(novelId, roleName) as SpeakerRow | undefined;

    if (row) {
      const profile = this.rowToProfile(row);
      this.inMemoryCache.set(key, profile);
      logger.info('加载角色声音', { novelId, roleName, baseVoice: profile.baseVoice });
      return profile;
    }

    // 3. 生成新声音
    return this.generateAndCache(novelId, roleName, portrait);
  }

  getSpeaker(novelId: string, roleName: string): SpeakerProfile | undefined {
    const key = this.cacheKey(novelId, roleName);
    const cached = this.inMemoryCache.get(key);
    if (cached) return cached;

    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM speakers WHERE novel_id = ? AND role_name = ?'
    ).get(novelId, roleName) as SpeakerRow | undefined;
    return row ? this.rowToProfile(row) : undefined;
  }

  listSpeakersByNovel(novelId: string): SpeakerProfile[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM speakers WHERE novel_id = ? AND role_name != ? ORDER BY created_at'
    ).all(novelId, NARRATION_ROLE_NAME) as SpeakerRow[];
    return rows.map((r) => this.rowToProfile(r));
  }

  listAllSpeakers(): SpeakerProfile[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM speakers ORDER BY novel_id, role_name'
    ).all() as SpeakerRow[];
    return rows.map((r) => this.rowToProfile(r));
  }

  deleteSpeaker(novelId: string, roleName: string): boolean {
    const db = getDb();
    const result = db.prepare(
      'DELETE FROM speakers WHERE novel_id = ? AND role_name = ?'
    ).run(novelId, roleName);
    this.inMemoryCache.delete(this.cacheKey(novelId, roleName));
    return result.changes > 0;
  }

  deleteNovelSpeakers(novelId: string): number {
    const db = getDb();
    const result = db.prepare('DELETE FROM speakers WHERE novel_id = ?').run(novelId);
    for (const [key] of this.inMemoryCache) {
      if (key.startsWith(`${novelId}::`)) this.inMemoryCache.delete(key);
    }
    return result.changes;
  }

  // ── 旁门 ──────────────────────────────────────────

  private _getOrCreateNarration(novelId: string): SpeakerProfile {
    const key = this.cacheKey(novelId, NARRATION_ROLE_NAME);

    // 内存缓存
    const cached = this.inMemoryCache.get(key);
    if (cached) return cached;

    // DB 缓存
    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM speakers WHERE novel_id = ? AND role_name = ?'
    ).get(novelId, NARRATION_ROLE_NAME) as SpeakerRow | undefined;
    if (row) {
      const profile = this.rowToProfile(row);
      this.inMemoryCache.set(key, profile);
      return profile;
    }

    // 首次：写入 DB
    const id = `narration-${novelId}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO speakers (id, novel_id, role_name, base_voice, description, portrait, speaker_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, novelId, NARRATION_ROLE_NAME, NARRATION_VOICE, '系统预设旁白音色', null, NARRATION_VOICE, now, now);

    const profile: SpeakerProfile = {
      id,
      novelId,
      roleName: NARRATION_ROLE_NAME,
      baseVoice: NARRATION_VOICE,
      description: '系统预设旁白音色',
      portrait: null,
      speakerId: NARRATION_VOICE,
      createdAt: now,
      updatedAt: now,
    };

    this.inMemoryCache.set(key, profile);
    logger.info('旁白使用固定音色', { voice: NARRATION_VOICE });
    return profile;
  }

  // ── 角色声音生成 ──────────────────────────────────

  private async generateAndCache(novelId: string, roleName: string, portrait?: CharacterPortrait): Promise<SpeakerProfile> {
    const baseVoice = portrait
      ? this.pickBaseVoiceByGender(portrait.gender)
      : this.pickBaseVoice(roleName);

    const voicePrompt = portrait
      ? characterAnalyzer.buildVoicePrompt(portrait)
      : this.defaultStyle(baseVoice);

    const promptText = `${voicePrompt}说：你好，我是${roleName}。`;

    logger.info('为角色生成声音', { roleName, baseVoice, hasPortrait: !!portrait });

    const speakerId = await cosyvoiceService.createSpeakerFromInstruct(baseVoice, promptText);

    const id = randomUUID();
    const now = new Date().toISOString();
    const portraitJson = portrait ? JSON.stringify(portrait) : null;

    const db = getDb();
    db.prepare(`
      INSERT INTO speakers (id, novel_id, role_name, base_voice, description, portrait, speaker_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, novelId, roleName, baseVoice, portrait?.voice_description ?? null, portraitJson, speakerId, now, now);

    const profile: SpeakerProfile = {
      id, novelId, roleName, baseVoice,
      description: portrait?.voice_description ?? null,
      portrait: portrait ?? null,
      speakerId, createdAt: now, updatedAt: now,
    };

    this.inMemoryCache.set(this.cacheKey(novelId, roleName), profile);
    logger.info('角色声音就绪', { roleName, baseVoice, hasPortrait: !!portrait });

    return profile;
  }

  // ── 音色分配 ──────────────────────────────────────

  private pickBaseVoiceByGender(gender: string): string {
    const pool = gender === 'male' ? MALE_VOICES : gender === 'female' ? FEMALE_VOICES : ALL_VOICES;
    const voice = pool[SpeakerManager.globalVoiceIndex % pool.length];
    SpeakerManager.globalVoiceIndex++;
    return voice;
  }

  private pickBaseVoice(name: string): string {
    const gender = this.guessGender(name);
    const pool = gender === 'male' ? MALE_VOICES : gender === 'female' ? FEMALE_VOICES : ALL_VOICES;
    const voice = pool[SpeakerManager.globalVoiceIndex % pool.length];
    SpeakerManager.globalVoiceIndex++;
    return voice;
  }

  private guessGender(name: string): 'male' | 'female' | null {
    const maleIndicators   = ['远','刚','强','峰','龙','飞','硕','川','宇','浩','杰','军','明','志'];
    const femaleIndicators = ['晴','雪','瑶','华','妙','婷','静','娜','丽','娟','红','玲','小'];
    for (const ch of name) {
      if (femaleIndicators.includes(ch)) return 'female';
      if (maleIndicators.includes(ch)) return 'male';
    }
    return null;
  }

  private defaultStyle(baseVoice: string): string {
    if (MALE_VOICES.includes(baseVoice))   return '用沉稳的男声';
    if (FEMALE_VOICES.includes(baseVoice)) return '用温柔的女声';
    return '用自然的声音';
  }

  private rowToProfile(row: SpeakerRow): SpeakerProfile {
    let portrait: CharacterPortrait | null = null;
    if (row.portrait) {
      try { portrait = JSON.parse(row.portrait); } catch { /* ignore */ }
    }
    return {
      id: row.id,
      novelId: row.novel_id,
      roleName: row.role_name,
      baseVoice: row.base_voice,
      description: row.description,
      portrait,
      speakerId: row.speaker_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const speakerManager = new SpeakerManager();
