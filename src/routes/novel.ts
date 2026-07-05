import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { speakerManager } from '../services/speaker_manager.js';
import { novelManager } from '../services/novel_manager.js';
import { characterAnalyzer } from '../services/character_analyzer.js';
import { NovelRequestSchema, NovelResponseSchema, type ChapterResult } from '../schemas/novel.schema.js';
import { NARRATION_ROLE_NAME } from '../db/schema.js';
import type { CharacterPortrait } from '../schemas/character.schema.js';

export async function novelRoutes(app: FastifyInstance) {
  /**
   * POST /novel/convert
   *
   * 完整流程：
   *   1. novel_title → 稳定 novel_id
   *   2. 大模型分析小说文本 → 角色画像（旁白不参与分析）
   *   3. 根据画像为每个角色生成独特声音，旁白使用固定音色
   *   4. 逐句合成 → 拼接 → 输出
   */
  app.post('/novel/convert', async (request, reply) => {
    const params = NovelRequestSchema.parse(request.body);

    // ── 第 1 步：小说标题 → 稳定 ID ──
    const novel = novelManager.getOrCreate(params.novel_title);
    logger.info('开始小说转换', {
      novelTitle: params.novel_title,
      novelId: novel.id,
      chapters: params.chapters.length,
    });

    // ── 第 2 步：大模型分析角色（排除旁白） ──
    const existingSpeakers = speakerManager.listSpeakersByNovel(novel.id);
    const existingNames = existingSpeakers
      .map((s) => s.roleName)
      .filter((n) => n !== NARRATION_ROLE_NAME);

    const analysis = await characterAnalyzer.analyze({
      chapters: params.chapters,
      existingCharacters: existingNames,
    });

    // 合并大模型分析与 character_descriptions（排除旁白）
    const portraitMap = new Map<string, CharacterPortrait>();
    for (const c of analysis.characters) {
      if (c.name === NARRATION_ROLE_NAME) continue;
      portraitMap.set(c.name, c);
    }
    if (params.character_descriptions) {
      for (const [name, desc] of Object.entries(params.character_descriptions)) {
        if (name === NARRATION_ROLE_NAME) continue;
        const existing = portraitMap.get(name);
        if (existing) {
          if (!existing.voice_description) existing.voice_description = desc;
        } else {
          portraitMap.set(name, {
            name, gender: 'unknown', age: '', height: '', build: '',
            personality: [], voice_description: desc, speaking_style: '', backstory_summary: '',
          });
        }
      }
    }

    logger.info('角色画像准备完成', {
      fromLLM: analysis.characters.length,
      fromDescriptions: params.character_descriptions ? Object.keys(params.character_descriptions).length : 0,
    });

    // ── 第 3 步：注册角色声音（旁白固定音色，其他角色调 CosyVoice） ──
    const registered: string[] = [];

    // 先注册旁白（固定音色，不走 API）
    const narrationProfile = await speakerManager.getOrCreateSpeaker(novel.id, NARRATION_ROLE_NAME);
    registered.push(NARRATION_ROLE_NAME);

    // 再注册其他角色
    for (const [roleName, portrait] of portraitMap) {
      const profile = await speakerManager.getOrCreateSpeaker(novel.id, roleName, portrait);
      registered.push(roleName);
      logger.info('角色声音就绪', {
        roleName,
        baseVoice: profile.baseVoice,
        gender: portrait.gender,
      });
    }

    // ── 第 4 步：逐句合成（TODO） ──
    logger.info('角色声音注册完成', { registered: registered.length });

    const chapterResults: ChapterResult[] = params.chapters.map(() => ({
      title: '', duration_seconds: 0, url: '',
    }));

    const response = NovelResponseSchema.parse({
      task_id: randomUUID(),
      status: 'failed',
      novel_id: novel.id,
      chapters: chapterResults,
      characters_registered: registered,
      character_analysis: analysis.characters.map((c) => ({
        name: c.name,
        gender: c.gender,
        voice_description: c.voice_description,
      })),
    });

    return reply.status(501).send({
      ...response,
      error: '逐句合成尚未实现',
    });
  });

  /**
   * GET /novels — 列出所有已注册的小说
   */
  app.get('/novels', async () => {
    const novels = novelManager.listAll();
    return { novels };
  });
}
