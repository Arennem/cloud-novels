import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { cosyvoiceService } from './cosyvoice.js';
import { characterAnalyzer } from './character_analyzer.js';
import { config } from '../config.js';
import { ensureDir } from '../utils/file.js';
import { resolve, join } from 'path';
import { writeFileSync } from 'fs';
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
  sample_audio_path: string | null;
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
  sampleAudioPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export class SpeakerManager {
  /** 跨实例共享 voiceIndex，保证 base voice 轮询不重复 */
  private static globalVoiceIndex = 0;
  private inMemoryCache = new Map<string, SpeakerProfile>();

  private cacheKey(novelId: string, roleName: string): string {
    return [novelId, '::', roleName].join('');
  }

  /**
   * 获取或创建角色声音
   * - 旁白：也通过声音设计 API 生成固定 voice_id
   * - 其他角色：首次调用 CosyVoice 声音设计 API 生成 speaker，之后复用
   */
  async getOrCreateSpeaker(novelId: string, roleName: string, portrait?: CharacterPortrait): Promise<SpeakerProfile> {
    if (roleName === NARRATION_ROLE_NAME) {
      return this._getOrCreateNarration(novelId, portrait);
    }

    const key = this.cacheKey(novelId, roleName);

    const cached = this.inMemoryCache.get(key);
    if (cached) return cached;

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
      'SELECT * FROM speakers WHERE novel_id = ? ORDER BY created_at'
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
    if (roleName === NARRATION_ROLE_NAME) {
      this.inMemoryCache.delete(this.cacheKey(novelId, NARRATION_ROLE_NAME));
    }
    return result.changes > 0;
  }

  deleteNovelSpeakers(novelId: string): number {
    const db = getDb();
    const result = db.prepare('DELETE FROM speakers WHERE novel_id = ?').run(novelId);
    for (const [key] of this.inMemoryCache) {
      if (key.startsWith(novelId + '::')) this.inMemoryCache.delete(key);
    }
    return result.changes;
  }

  /**
   * 更新角色画像（包括旁白），用于人工微调 voice_description / voice_prompt 等。
   * 更新后仅持久化，不会自动重新创建 CosyVoice 音色。
   * 如需重新生成音色，先调此接口更新 portrait，再调 regenerate。
   */
  updateSpeakerPortrait(novelId: string, roleName: string, portrait: CharacterPortrait): boolean {
    const key = this.cacheKey(novelId, roleName);
    const now = new Date().toISOString();
    const portraitJson = JSON.stringify(portrait);
    const db = getDb();
    const result = db.prepare('UPDATE speakers SET portrait = ?, description = ?, updated_at = ? WHERE novel_id = ? AND role_name = ?').run(portraitJson, portrait.voice_description ?? null, now, novelId, roleName);
    if (result.changes > 0) {
      const existing = this.inMemoryCache.get(key);
      if (existing) {
        existing.portrait = portrait;
        existing.description = portrait.voice_description ?? null;
        existing.updatedAt = now;
      }
      logger.info('角色画像已更新', { novelId, roleName });
      return true;
    }
    return false;
  }

  // -- 旁门：旁白声音生成（也用声音设计 API） --

  /** 默认旁白声音描述 */
  private readonly DEFAULT_NARRATION_PROMPT =
    '沉稳温和的中性叙述声，' +
    '音色醇厚自然，语速中速平缓，吐字清晰，' +
    '语调沉稳大气，富有叙述感和故事性，' +
    '适合用于小说旁白朗读';

  private async _getOrCreateNarration(novelId: string, portrait?: CharacterPortrait): Promise<SpeakerProfile> {
    const key = this.cacheKey(novelId, NARRATION_ROLE_NAME);

    const cached = this.inMemoryCache.get(key);
    if (cached) return cached;

    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM speakers WHERE novel_id = ? AND role_name = ?'
    ).get(novelId, NARRATION_ROLE_NAME) as SpeakerRow | undefined;

    if (row) {
      const profile = this.rowToProfile(row);
      this.inMemoryCache.set(key, profile);
      logger.info('加载旁白声音', { novelId, speakerId: profile.speakerId });
      return profile;
    }

    // 首次创建：用声音设计 API 生成旁白音色
    const voicePrompt = portrait?.voice_prompt
      || (portrait ? characterAnalyzer.buildVoicePrompt(portrait) : null)
      || this.DEFAULT_NARRATION_PROMPT;

    const description = portrait?.voice_description ?? '旁白音色';
    const prefix = 'narration_' + novelId.slice(0, 8);
    const previewText = '欢迎收听本篇小说。';

    logger.info('旁白：调用声音设计 API 创建音色', { novelId, prompt: voicePrompt.slice(0, 60) });

    const voiceId = await cosyvoiceService.designVoice(voicePrompt, prefix, previewText);
    const speakerId = voiceId || NARRATION_VOICE;

    const id = 'narration-' + novelId;
    const now = new Date().toISOString();
    const portraitJson = portrait ? JSON.stringify(portrait) : null;

    // 生成示例音频
    const sampleText = '欢迎收听本篇小说。';
    const sampleAudioPath = await this._generateSampleAudio(novelId, NARRATION_ROLE_NAME, speakerId, sampleText);

    // sample_audio_path 需要是相对路径，用于 URL 访问
    const sampleUrlPath = sampleAudioPath || null;

    db.prepare([
      'INSERT INTO speakers (id, novel_id, role_name, base_voice, description, portrait, speaker_id, sample_audio_path, created_at, updated_at)'
    ].join(' ') + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, novelId, NARRATION_ROLE_NAME, NARRATION_VOICE, description, portraitJson, speakerId, sampleUrlPath, now, now);

    const profile: SpeakerProfile = {
      id,
      novelId,
      roleName: NARRATION_ROLE_NAME,
      baseVoice: NARRATION_VOICE,
      description: description,
      portrait: portrait ?? null,
      speakerId,
      sampleAudioPath: sampleUrlPath,
      createdAt: now,
      updatedAt: now,
    };

    this.inMemoryCache.set(key, profile);
    logger.info('旁白音色创建完成', { novelId, speakerId, hasPortrait: !!portrait, hasSample: !!sampleUrlPath });
    return profile;
  }

  // -- 角色声音生成 --

  private async generateAndCache(novelId: string, roleName: string, portrait?: CharacterPortrait): Promise<SpeakerProfile> {
    const baseVoice = portrait
      ? this.pickBaseVoiceByGender(portrait.gender)
      : this.pickBaseVoice(roleName);

    const voicePrompt = portrait
      ? (portrait.voice_prompt || characterAnalyzer.buildVoicePrompt(portrait))
      : this.defaultStyle(baseVoice);

    const prefix = roleName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 40);
    const previewText = '你好，我是' + roleName + '。';
    const voiceId = await cosyvoiceService.designVoice(voicePrompt, prefix, previewText);
    const speakerId = voiceId || baseVoice;

    logger.info('为角色生成声音', { roleName, baseVoice, speakerId, hasPortrait: !!portrait });

    // 生成示例音频：角色自我介绍
    const sampleText = '你好，我是' + roleName + '。';
    const sampleAudioPath = await this._generateSampleAudio(novelId, roleName, speakerId, sampleText);

    const id = randomUUID();
    const now = new Date().toISOString();
    const portraitJson = portrait ? JSON.stringify(portrait) : null;

    const db = getDb();
    db.prepare([
      'INSERT INTO speakers (id, novel_id, role_name, base_voice, description, portrait, speaker_id, sample_audio_path, created_at, updated_at)'
    ].join(' ') + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, novelId, roleName, baseVoice, (portrait?.voice_description ?? null), portraitJson, speakerId, (sampleAudioPath ?? null), now, now);

    const profile: SpeakerProfile = {
      id, novelId, roleName, baseVoice,
      description: portrait?.voice_description ?? null,
      portrait: portrait ?? null,
      speakerId,
      sampleAudioPath: sampleAudioPath ?? null,
      createdAt: now, updatedAt: now,
    };

    this.inMemoryCache.set(this.cacheKey(novelId, roleName), profile);
    logger.info('角色声音就绪', { roleName, baseVoice, hasPortrait: !!portrait, hasSample: !!sampleAudioPath });

    return profile;
  }

  // -- 示例音频生成（角色音色创建后自动生成，用于人工试听） --

  /**
   * 使用已创建的 voice_id 合成一段示例音频并保存到 speaker-samples 目录。
   * 示例音频和章节音频分开存放：./output/speaker-samples/
   *
   * @returns web 可访问的相对路径（如 "/speaker-samples/xxx.mp3"），失败返回 null
   */
  private async _generateSampleAudio(
    novelId: string,
    roleName: string,
    speakerId: string,
    sampleText: string,
  ): Promise<string | null> {
    try {
      const sampleDir = resolve(config.OUTPUT_DIR, 'speaker-samples');
      ensureDir(sampleDir);

      // 文件名：novelId前8位 + 角色名清洗 + .mp3
      const safeName = roleName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 40);
      const filename = novelId.slice(0, 8) + '-' + safeName + '.mp3';
      const filePath = join(sampleDir, filename);

      logger.info('生成角色示例音频', { novelId, roleName, sampleText });

      const audio = await cosyvoiceService.synthesizeWithSpeaker(sampleText, speakerId, 'mp3');
      writeFileSync(filePath, audio);

      logger.info('角色示例音频已保存', { novelId, roleName, path: filePath, size: audio.length });
      return '/speaker-samples/' + encodeURIComponent(filename);
    } catch (err) {
      logger.warn('角色示例音频生成失败（不影响主线合成）', {
        novelId, roleName, speakerId, error: String(err),
      });
      return null;
    }
  }

  // -- 音色分配 --

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
    const maleIndicators   = ['远','刚','强','峰','龙','风','硬','坚','宏','海','林','军','明','志'];
    const femaleIndicators = ['晴','雪','瑶','婷','如','嫣','静','婉','玉','娴','红','玲','小'];
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
      sampleAudioPath: row.sample_audio_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const speakerManager = new SpeakerManager();