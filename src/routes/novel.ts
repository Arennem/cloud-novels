import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { speakerManager } from '../services/speaker_manager.js';
import { novelManager } from '../services/novel_manager.js';
import { characterAnalyzer } from '../services/character_analyzer.js';
import { cosyvoiceService } from '../services/cosyvoice.js';
import { audioMerger } from '../services/audio_merger.js';
import { textSplitter } from '../services/text_splitter.js';
import { audioCache, computeContentHash } from '../services/audio_cache.js';
import { NovelRequestSchema, type ChapterResult } from '../schemas/novel.schema.js';
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

    // 角色名 → speaker 映射表
    const speakerMap = new Map<string, string>();
    speakerMap.set(NARRATION_ROLE_NAME, narrationProfile.speakerId);

    // 注册其他角色
    for (const [roleName, portrait] of portraitMap) {
      const profile = await speakerManager.getOrCreateSpeaker(novel.id, roleName, portrait);
      speakerMap.set(roleName, profile.speakerId);
      registered.push(roleName);
      logger.info('角色声音就绪', {
        roleName,
        baseVoice: profile.baseVoice,
        gender: portrait.gender,
      });
    }

    logger.info('角色声音注册完成', { registered: registered.length });

    // ── 第 4 步：逐句合成 ──
    const chapterResults: ChapterResult[] = [];
    const chapterAudioBuffers: Buffer[] = [];

    for (let ci = 0; ci < params.chapters.length; ci++) {
      const chapter = params.chapters[ci];
      const chContentHash = computeContentHash(chapter.content);
      const fmt = params.output_format;

      // 缓存检查
      if (params.cache !== false) {
        const cached = audioCache.getChapterAudio(novel.id, chapter.title, chContentHash);
        if (cached) {
          logger.info('章节命中缓存，跳过合成', { chapter: chapter.title });
          chapterAudioBuffers.push(cached);
          chapterResults.push({
            title: chapter.title,
            duration_seconds: 0,
            url: '',
          });
          continue;
        }
      }

      // 解析角色标记
      const chunks = textSplitter.parseRoles(chapter.content);
      logger.info('解析章节文本', { chapter: chapter.title, segments: chunks.length });

      // 增量追加到临时文件
      const tempPath = audioCache.startChapterAudio(novel.id, chapter.title, fmt);
      const segmentBuffers: Buffer[] = [];

      for (const chunk of chunks) {
        const speakerId = chunk.role
          ? (speakerMap.get(chunk.role) ?? speakerMap.get(NARRATION_ROLE_NAME)!)
          : speakerMap.get(NARRATION_ROLE_NAME)!;

        try {
          const audio = await cosyvoiceService.synthesizeWithSpeaker(
            chunk.text,
            speakerId,
            fmt,
          );
          segmentBuffers.push(audio);
          audioCache.appendSegment(tempPath, audio);
        } catch (err) {
          logger.error('段落合成失败', {
            chapter: chapter.title,
            role: chunk.role ?? '旁白',
            text: chunk.text.slice(0, 20),
            error: String(err),
          });
          // 继续合成剩余段落
        }
      }

      if (segmentBuffers.length === 0) {
        logger.warn('章节无可用合成结果', { chapter: chapter.title });
        chapterResults.push({
          title: chapter.title,
          duration_seconds: 0,
          url: '',
        });
        continue;
      }

      // 合并章节内所有段落
      const mergedChapter = await audioMerger.merge(segmentBuffers, fmt);

      // 缓存到音频缓存（原子重命名）
      audioCache.finalizeChapterAudio(novel.id, chapter.title, chContentHash, fmt, tempPath);

      chapterAudioBuffers.push(mergedChapter);
      chapterResults.push({
        title: chapter.title,
        duration_seconds: 0,
        url: '/' + novel.id.slice(0, 8) + '-' + encodeURIComponent(chapter.title) + '.' + fmt,
      });

      logger.info('章节合成完成', { chapter: chapter.title, segments: segmentBuffers.length });
    }

    // ── 第 5 步：可选合并 ──
    let finalUrl = '';
    if (params.merge && chapterAudioBuffers.length > 1) {
      try {
        const merged = await audioMerger.merge(chapterAudioBuffers, params.output_format);
        const mergedKey = novel.id.slice(0, 8) + '-merged.' + params.output_format;
        const mergedPath = audioCache.saveChapterAudio(
          novel.id, '__merged__', computeContentHash(chapterAudioBuffers.map(b => b.length).join(',')),
          merged, params.output_format,
        );
        finalUrl = '/' + mergedKey;
        logger.info('全书合并完成', { path: mergedPath, size: merged.length });
      } catch (err) {
        logger.error('全书合并失败', { error: String(err) });
      }
    }

    const succeeded = chapterResults.filter((r) => r.url !== '').length;
    const status = succeeded === params.chapters.length ? 'completed' : succeeded > 0 ? 'processing' : 'failed';

    return reply.status(status === 'failed' ? 500 : 200).send({
      task_id: randomUUID(),
      status,
      novel_id: novel.id,
      chapters: chapterResults,
      characters_registered: registered,
      character_analysis: analysis.characters.map((c) => ({
        name: c.name,
        gender: c.gender,
        voice_description: c.voice_description,
      })),
      ...(finalUrl ? { merged_url: finalUrl } : {}),
    });
  });

  // ── 小说管理 ──
  app.get('/novels', async () => ({ novels: novelManager.listAll() }));

  app.get('/novels/:novelId', async (request, reply) => {
    const { novelId } = request.params as { novelId: string };
    const novel = novelManager.getById(novelId);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });
    return novel;
  });

  app.delete('/novels/:novelId', async (request, reply) => {
    const { novelId } = request.params as { novelId: string };
    const deleted = novelManager.delete(novelId);
    if (!deleted) return reply.status(404).send({ error: '小说未找到' });
    return { status: 'deleted', novel_id: novelId };
  });

  // ── 角色声音管理 ──
  app.get('/characters', async () => ({ characters: speakerManager.listAllSpeakers() }));

  app.get('/novels/:novelId/characters', async (request) => {
    const { novelId } = request.params as { novelId: string };
    return { characters: speakerManager.listSpeakersByNovel(novelId) };
  });

  app.delete('/novels/:novelId/characters/:roleName', async (request, reply) => {
    const { novelId, roleName } = request.params as { novelId: string; roleName: string };
    const deleted = speakerManager.deleteSpeaker(novelId, roleName);
    if (!deleted) return reply.status(404).send({ error: '角色未找到' });
    return { status: 'deleted', roleName };
  });
}
