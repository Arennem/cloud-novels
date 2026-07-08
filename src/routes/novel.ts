import type { FastifyInstance } from 'fastify';
import { routeSchema } from '../swagger-helper.js';
import { randomUUID } from 'crypto';
import { success, fail, paginated } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { speakerManager } from '../services/speaker_manager.js';
import { novelManager } from '../services/novel_manager.js';
import { characterAnalyzer } from '../services/character_analyzer.js';
import { cosyvoiceService } from '../services/cosyvoice.js';
import { audioMerger } from '../services/audio_merger.js';
import { textSplitter } from '../services/text_splitter.js';
import { audioCache, computeContentHash } from '../services/audio_cache.js';
import {
  ConvertRequestSchema,
  UploadRequestSchema,
  AnalyzeRequestSchema,
  NovelQuerySchema,
  CharacterQuerySchema,
  CharacterDeleteSchema,
  NovelAudioQuerySchema,
  ChapterAudioQuerySchema,
  ChapterQuerySchema,
  RegisterSpeakersRequestSchema,
  SynthesizeRequestSchema,
  RegenerateSpeakerRequestSchema,
  SynthesizeResultSchema,
  type ChapterResult,
  type SynthesizeResult,
} from '../schemas/novel.schema.js';
import { NARRATION_ROLE_NAME } from '../db/schema.js';
import type { CharacterPortrait } from '../schemas/character.schema.js';

export async function novelRoutes(app: FastifyInstance) {
  // ── 上传：原始文本 → 解析章节 ──────────────────────
  app.post('/novel/upload', {
    schema: routeSchema({
      description: '上传小说原始文本，自动解析为章节列表',
      tags: ['novel'],
      summary: '上传文本',
      body: {
        type: 'object', required: ['novel_title', 'content'], properties: {
          novel_title: { type: 'string', description: '小说名称' },
          content: { type: 'string', description: '小说文本内容' },
        },
      },
      response: { '200': { description: '解析成功', data: {
        type: 'object', properties: {
          novel_title: { type: 'string' },
          chapters: { type: 'object', properties: { total: { type: 'integer' }, pageNum: { type: 'integer' }, pageSize: { type: 'integer' }, list: { type: 'array', items: { type: 'object' } } } },
        },
      } } },
    }),
  }, async (request, reply) => {
    const contentType = request.headers['content-type'] ?? '';
    let novelTitle: string;
    let content: string;

    if (contentType.includes('multipart/form-data')) {
      const parts = request.parts();
      const fields: Record<string, string> = {};
      let fileBuffer: Buffer | null = null;

      for await (const part of parts) {
        if (part.type === 'field') {
          fields[part.fieldname] = part.value as string;
        } else if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
        }
      }

      novelTitle = fields['novel_title'];
      content = fileBuffer ? fileBuffer.toString('utf-8') : fields['content'] ?? '';
    } else {
      const body = request.body as Record<string, unknown>;
      novelTitle = typeof body['novel_title'] === 'string' ? body['novel_title'] : '';
      content = typeof body['content'] === 'string' ? body['content'] : '';
    }

    const params = UploadRequestSchema.parse({ novel_title: novelTitle, content });
    const chapters = textSplitter.parseChaptersFromText(params.content);

    logger.info('上传文本解析完成', {
      novel_title: params.novel_title,
      chapter_count: chapters.length,
      total_chars: params.content.length,
    });

    // 持久化章节到数据库
    const novel = novelManager.getOrCreate(params.novel_title);
    novelManager.saveChapters(novel.id, chapters);

    return success({
      novel_title: params.novel_title,
      chapters: paginated(chapters),
    });
  });

  // ── 分析：仅 LLM 角色分析，不含合成 ────────────────
  app.post('/novel/analyze', {
    schema: routeSchema({
      description: '对已有章节进行 LLM 角色分析，不含语音合成',
      tags: ['novel'],
      summary: '角色分析',
      body: {
        type: 'object', required: ['novel_title', 'chapters'], properties: {
          novel_title: { type: 'string', description: '小说名称' },
          chapters: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } } }, description: '章节列表' },
          character_descriptions: { type: 'object', additionalProperties: { type: 'string' }, description: '可选的角色声音描述，key 为角色名，value 为声音特征描述' },
        },
      },
      response: {
        '200': { description: '分析完成', data: { type: 'object', properties: { characters: { type: 'object', properties: { total: { type: 'integer' }, list: { type: 'array', items: { type: 'object' } }, pageNum: { type: 'integer' }, pageSize: { type: 'integer' } } } } } },
      },
    }),
  }, async (request, reply) => {
    const params = AnalyzeRequestSchema.parse(request.body);

    logger.info('开始独立角色分析', {
      novel_title: params.novel_title,
      chapters: params.chapters.length,
    });

    let existingNames: string[] = [];
    const novel = novelManager.getByTitle(params.novel_title);
    if (novel) {
      const existingSpeakers = speakerManager.listSpeakersByNovel(novel.id);
      existingNames = existingSpeakers
        .map((s) => s.roleName)
        .filter((n) => n !== NARRATION_ROLE_NAME);
    }

    const analysis = await characterAnalyzer.analyze({
      chapters: params.chapters,
      existingCharacters: existingNames,
    });

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

    const characters = [...portraitMap.values()];

    logger.info('角色分析完成', {
      novel_title: params.novel_title,
      character_count: characters.length,
      fromLLM: analysis.characters.length,
      fromDescriptions: params.character_descriptions ? Object.keys(params.character_descriptions).length : 0,
    });

    return success({ characters: paginated(characters) });
  });

  // ── 合成：完整流程 ────────────────────────────────
  app.post('/novel/convert', {
    schema: routeSchema({
      description: '完整合成流程：角色分析 → 注册声音 → 逐句语音合成',
      tags: ['novel'],
      summary: '合成语音',
      body: {
        type: 'object', required: ['novel_title', 'chapters'], properties: {
          novel_title: { type: 'string', description: '小说名称' },
          chapters: { type: 'array', items: { type: 'object' }, description: '章节列表' },
          output_format: { type: 'string', enum: ['wav', 'mp3', 'pcm'], default: 'mp3' },
          merge: { type: 'boolean', default: false, description: '是否合并为单个音频文件' },
          cache: { type: 'boolean', default: true, description: '是否使用音频缓存' },
          character_descriptions: { type: 'object', additionalProperties: { type: 'string' }, description: '角色声音描述' },
          character_overrides: { type: 'object', description: '角色画像覆盖' },
        },
      },
      response: { '200': { description: '合成任务创建成功', data: {
        type: 'object', properties: {
          task_id: { type: 'string', format: 'uuid' },
          task_status: { type: 'string', enum: ['completed', 'processing'] },
          novel_id: { type: 'string' },
          chapters: { type: 'object' },
          characters_registered: { type: 'array', items: { type: 'string' } },
          merged_url: { type: 'string' },
        },
      } } },
    }),
  }, async (request, reply) => {
    const params = ConvertRequestSchema.parse(request.body);

    const novel = novelManager.getOrCreate(params.novel_title);
    logger.info('开始小说转换', {
      novelTitle: params.novel_title,
      novelId: novel.id,
      chapters: params.chapters.length,
    });

    const existingSpeakers = speakerManager.listSpeakersByNovel(novel.id);
    const existingNames = existingSpeakers
      .map((s) => s.roleName)
      .filter((n) => n !== NARRATION_ROLE_NAME);

    const analysis = await characterAnalyzer.analyze({
      chapters: params.chapters,
      existingCharacters: existingNames,
    });

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
    if (params.character_overrides) {
      for (const [name, overrides] of Object.entries(params.character_overrides)) {
        if (name === NARRATION_ROLE_NAME) continue;
        const existing = portraitMap.get(name);
        if (existing) {
          Object.assign(existing, overrides);
        } else {
          portraitMap.set(name, {
            name,
            gender: overrides.gender ?? 'unknown',
            age: overrides.age ?? '',
            height: overrides.height ?? '',
            build: overrides.build ?? '',
            personality: overrides.personality ?? [],
            voice_description: overrides.voice_description ?? '',
            speaking_style: overrides.speaking_style ?? '',
            backstory_summary: overrides.backstory_summary ?? '',
          });
        }
      }
    }

    logger.info('角色画像准备完成', {
      fromLLM: analysis.characters.length,
      fromDescriptions: params.character_descriptions ? Object.keys(params.character_descriptions).length : 0,
      fromOverrides: params.character_overrides ? Object.keys(params.character_overrides).length : 0,
    });

    // ── 注册角色声音 ──
    const registered: string[] = [];
    const narrationProfile = await speakerManager.getOrCreateSpeaker(novel.id, NARRATION_ROLE_NAME);
    registered.push(NARRATION_ROLE_NAME);

    const speakerMap = new Map<string, string>();
    speakerMap.set(NARRATION_ROLE_NAME, narrationProfile.speakerId);

    for (const [roleName, portrait] of portraitMap) {
      const profile = await speakerManager.getOrCreateSpeaker(novel.id, roleName, portrait);
      speakerMap.set(roleName, profile.speakerId);
      registered.push(roleName);
    }

    logger.info('角色声音注册完成', { registered: registered.length });

    // ── 逐句合成 ──
    const chapterResults: ChapterResult[] = [];
    const chapterAudioBuffers: Buffer[] = [];

    for (let ci = 0; ci < params.chapters.length; ci++) {
      const chapter = params.chapters[ci];
      const chContentHash = computeContentHash(chapter.content);
      const fmt = params.output_format;

      if (params.cache !== false) {
        const cached = audioCache.getChapterAudio(novel.id, chapter.title, chContentHash);
        if (cached) {
          chapterAudioBuffers.push(cached);
          chapterResults.push({ title: chapter.title, duration_seconds: 0, url: '' });
          continue;
        }
      }

      const chunks = textSplitter.parseRoles(chapter.content);
      const tempPath = audioCache.startChapterAudio(novel.id, chapter.title, fmt);
      const segmentBuffers: Buffer[] = [];

      for (const chunk of chunks) {
        const speakerId = chunk.role
          ? (speakerMap.get(chunk.role) ?? speakerMap.get(NARRATION_ROLE_NAME)!)
          : speakerMap.get(NARRATION_ROLE_NAME)!;

        try {
          const audio = await cosyvoiceService.synthesizeWithSpeaker(chunk.text, speakerId, fmt);
          segmentBuffers.push(audio);
          audioCache.appendSegment(tempPath, audio);
        } catch (err) {
          logger.error('段落合成失败', {
            chapter: chapter.title, role: chunk.role ?? '旁白',
            text: chunk.text.slice(0, 20), error: String(err),
          });
        }
      }

      if (segmentBuffers.length === 0) {
        chapterResults.push({ title: chapter.title, duration_seconds: 0, url: '' });
        continue;
      }

      const mergedChapter = await audioMerger.merge(segmentBuffers, fmt);
      audioCache.finalizeChapterAudio(novel.id, chapter.title, chContentHash, fmt, tempPath);
      chapterAudioBuffers.push(mergedChapter);
      chapterResults.push({
        title: chapter.title, duration_seconds: 0,
        url: '/' + novel.id.slice(0, 8) + '-' + encodeURIComponent(chapter.title) + '.' + fmt,
      });
    }

    let finalUrl = '';
    if (params.merge && chapterAudioBuffers.length > 1) {
      try {
        const merged = await audioMerger.merge(chapterAudioBuffers, params.output_format);
        const mergedKey = novel.id.slice(0, 8) + '-merged.' + params.output_format;
        audioCache.saveChapterAudio(
          novel.id, '__merged__',
          computeContentHash(chapterAudioBuffers.map(b => b.length).join(',')),
          merged, params.output_format,
        );
        finalUrl = '/' + mergedKey;
      } catch (err) {
        logger.error('全书合并失败', { error: String(err) });
      }
    }

    const succeeded = chapterResults.filter((r) => r.url !== '').length;

    if (succeeded === 0) {
      return reply.status(500).send(fail('所有章节合成失败', 500));
    }

    const taskStatus = succeeded === params.chapters.length ? 'completed' as const
      : 'processing' as const;

    return success({
      task_id: randomUUID(),
      task_status: taskStatus,
      novel_id: novel.id,
      chapters: paginated(chapterResults),
      characters_registered: registered,
      character_analysis: analysis.characters.map((c) => ({
        name: c.name, gender: c.gender, voice_description: c.voice_description,
      })),
      ...(finalUrl ? { merged_url: finalUrl } : {}),
    });
  });


  // ── 音频缓存查询 ────────────────────────────────
  app.get('/novel/audio', {
    schema: routeSchema({
      description: '查询小说的音频缓存记录',
      tags: ['novel'],
      summary: '音频缓存查询',
      querystring: {
        type: 'object', properties: {
          novel_id: { type: 'string', description: '小说 ID' },
          novel_title: { type: 'string', description: '小说名称' },
        },
      },
      response: { '200': { description: '查询成功', data: {
        type: 'object', properties: { audio: { type: 'object' } },
      } } },
    }),
  }, async (request, reply) => {
    const q = NovelAudioQuerySchema.parse(request.query);

    // 按 novel_id 或 novel_title 查询
    let novelId = q.novel_id;
    if (!novelId && q.novel_title) {
      const novel = novelManager.getByTitle(q.novel_title);
      if (!novel) return reply.status(404).send(fail('小说未找到', 404));
      novelId = novel.id;
    }

    const records = audioCache.listByNovel(novelId!);
    return success({ audio: paginated(records) });
  });

  app.get('/novel/audio/chapter', {
    schema: routeSchema({
      description: '按章节名查询音频缓存记录',
      tags: ['novel'],
      summary: '章节音频查询',
      querystring: {
        type: 'object', required: ['chapter_title'], properties: {
          chapter_title: { type: 'string', description: '章节标题' },
          novel_id: { type: 'string', description: '小说 ID' },
          novel_title: { type: 'string', description: '小说名称' },
        },
      },
      response: { '200': { description: '查询成功', data: {
        type: 'object', properties: { audio: { type: 'object' } },
      } } },
    }),
  }, async (request, reply) => {
    const q = ChapterAudioQuerySchema.parse(request.query);

    // 解析 novel_id（如果有 novel_title 则转成 id）
    let novelId = q.novel_id;
    if (q.novel_title) {
      const novel = novelManager.getByTitle(q.novel_title);
      if (!novel) return reply.status(404).send(fail('小说未找到', 404));
      novelId = novel.id;
    }

    const records = audioCache.listByChapterTitle(q.chapter_title, novelId);
    return success({ audio: paginated(records) });
  });
  // ── 小说管理 ──
  app.get('/novels', {
    schema: routeSchema({
      description: '获取所有小说列表',
      tags: ['novel'],
      summary: '小说列表',
      response: { '200': { description: '查询成功', data: {
        type: 'object', properties: { novels: { type: 'object' } },
      } } },
    }),
  }, async () => {
    const novels = novelManager.listAll();
    return success({ novels: paginated(novels) });
  });

  // GET /novel?id=xxx — 查小说详情
  app.get('/novel', {
    schema: routeSchema({
      description: '按 ID 查询小说详情',
      tags: ['novel'],
      summary: '小说详情',
      querystring: {
        type: 'object', required: ['id'], properties: {
          id: { type: 'string', description: '小说 ID' },
        },
      },
      response: {
        '200': { description: '查询成功' },
        '404': { description: '小说未找到' },
      },
    }),
  }, async (request, reply) => {
    const { id } = NovelQuerySchema.parse(request.query);
    const novel = novelManager.getById(id);
    if (!novel) return reply.status(404).send(fail('小说未找到', 404));
    return success(novel);
  });

  // ── 章节查询 ──

  // GET /novel/chapters?novel_title=xxx — 查询小说章节
  app.get('/novel/chapters', {
    schema: routeSchema({
      description: '查询小说的章节列表',
      tags: ['novel'],
      summary: '章节列表',
      querystring: {
        type: 'object', properties: {
          novel_title: { type: 'string', description: '小说名称' },
          novel_id: { type: 'string', description: '小说 ID' },
        },
      },
      response: {
        '200': { description: '查询成功', data: { type: 'object', properties: { chapters: { type: 'object' } } } },
        '404': { description: '未找到小说或无章节记录' },
      },
    }),
  }, async (request, reply) => {
    const q = ChapterQuerySchema.parse(request.query);

    let novelId = q.novel_id;
    if (!novelId && q.novel_title) {
      const novel = novelManager.getByTitle(q.novel_title);
      if (!novel) return reply.status(404).send(fail('小说未找到', 404));
      novelId = novel.id;
    }

    const chapters = novelManager.getChapters(novelId!);
    if (chapters.length === 0) {
      return reply.status(404).send(fail('该小说暂无章节记录，请先上传', 404));
    }
    return success({ chapters: paginated(chapters) });
  });

  // POST /novel/delete  body: { id } — 删除小说
  app.post('/novel/delete', {
    schema: routeSchema({
      description: '按 ID 删除小说及其相关数据',
      tags: ['novel'],
      summary: '删除小说',
      body: {
        type: 'object', required: ['id'], properties: {
          id: { type: 'string', description: '小说 ID' },
        },
      },
      response: {
        '200': { description: '删除成功', data: { type: 'object', properties: { novel_id: { type: 'string' } } } },
        '404': { description: '小说未找到' },
      },
    }),
  }, async (request, reply) => {
    const { id } = NovelQuerySchema.parse(request.body);
    const deleted = novelManager.delete(id);
    if (!deleted) return reply.status(404).send(fail('小说未找到', 404));
    return success({ novel_id: id });
  });

  // ── 角色声音管理 ──

  // GET /characters?novel_id=xxx — 列出角色（不带参则全部）
  app.get('/characters', {
    schema: routeSchema({
      description: '列出角色列表，可按 novel_id 过滤',
      tags: ['character'],
      summary: '角色列表',
      querystring: {
        type: 'object', properties: {
          novel_id: { type: 'string', description: '小说 ID（可选，不传则返回全部角色）' },
        },
      },
      response: { '200': { description: '查询成功', data: { type: 'object', properties: { characters: { type: 'object' } } } } },
    }),
  }, async (request) => {
    const q = request.query as Record<string, string>;
    if (q.novel_id) {
      const { novel_id } = CharacterQuerySchema.parse(q);
      return success({ characters: paginated(speakerManager.listSpeakersByNovel(novel_id)) });
    }
    return success({ characters: paginated(speakerManager.listAllSpeakers()) });
  });

  // POST /characters/delete  body: { novel_id, role_name } — 删除角色
  app.post('/characters/delete', {
    schema: routeSchema({
      description: '删除指定小说的指定角色',
      tags: ['character'],
      summary: '删除角色',
      body: {
        type: 'object', required: ['novel_id', 'role_name'], properties: {
          novel_id: { type: 'string', description: '小说 ID' },
          role_name: { type: 'string', description: '角色名' },
        },
      },
      response: {
        '200': { description: '删除成功', data: { type: 'object', properties: { role_name: { type: 'string' } } } },
        '404': { description: '角色未找到' },
      },
    }),
  }, async (request, reply) => {
    const { novel_id, role_name } = CharacterDeleteSchema.parse(request.body);
    const deleted = speakerManager.deleteSpeaker(novel_id, role_name);
    if (!deleted) return reply.status(404).send(fail('角色未找到', 404));
    return success({ role_name });
  });
  // ── 手动流程：注册角色声音（从已存储的章节中分析角色并注册） ──
  app.post('/novel/speakers/register', {
    schema: routeSchema({
      description: '从已存储的章节中通过 LLM 分析角色，注册所有角色声音到 CosyVoice。这是手动流程的第一步，需先上传小说文本。',
      tags: ['novel'],
      summary: '注册角色声音',
      body: {
        type: 'object', properties: {
          novel_id: { type: 'string', description: '小说 ID（与 novel_title 二选一）' },
          novel_title: { type: 'string', description: '小说名称（与 novel_id 二选一）' },
          character_descriptions: { type: 'object', additionalProperties: { type: 'string' }, description: '可选的角色声音描述' },
          character_overrides: { type: 'object', description: '可选的角色画像覆盖' },
        },
      },
      response: { '200': { description: '注册完成', data: {
        type: 'object', properties: {
          novel_id: { type: 'string' },
          characters_registered: { type: 'array', items: { type: 'string' } },
          character_analysis: { type: 'array', items: { type: 'object' } },
          chapters_available: { type: 'integer' },
        },
      } } },
    }),
  }, async (request, reply) => {
    const params = RegisterSpeakersRequestSchema.parse(request.body);

    // ── 解析 novel_id ──
    let novelId = params.novel_id;
    if (!novelId && params.novel_title) {
      const novel = novelManager.getByTitle(params.novel_title);
      if (!novel) return reply.status(404).send(fail('小说未找到，请先上传', 404));
      novelId = novel.id;
    }
    if (!novelId) return reply.status(400).send(fail('novel_id 或 novel_title 必填', 400));

    // ── 加载已存储的章节 ──
    const storedChapters = novelManager.getChapters(novelId);
    if (storedChapters.length === 0) {
      return reply.status(404).send(fail('该小说暂无章节记录，请先上传', 404));
    }
    logger.info('从存储加载章节', { novelId, chapters: storedChapters.length });

    // ── 已有角色 ──
    const existingSpeakers = speakerManager.listSpeakersByNovel(novelId);
    const existingNames = existingSpeakers
      .map((s) => s.roleName)
      .filter((n) => n !== NARRATION_ROLE_NAME);

    // ── LLM 分析 ──
    const analysis = await characterAnalyzer.analyze({
      chapters: storedChapters.map((c) => ({ title: c.title, content: c.content })),
      existingCharacters: existingNames,
    });

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
    if (params.character_overrides) {
      for (const [name, overrides] of Object.entries(params.character_overrides)) {
        if (name === NARRATION_ROLE_NAME) continue;
        const existing = portraitMap.get(name);
        if (existing) {
          Object.assign(existing, overrides);
        } else {
          portraitMap.set(name, {
            name,
            gender: overrides.gender ?? 'unknown',
            age: overrides.age ?? '',
            height: overrides.height ?? '',
            build: overrides.build ?? '',
            personality: overrides.personality ?? [],
            voice_description: overrides.voice_description ?? '',
            speaking_style: overrides.speaking_style ?? '',
            backstory_summary: overrides.backstory_summary ?? '',
          });
        }
      }
    }

    logger.info('角色画像准备完成', {
      fromLLM: analysis.characters.length,
      fromDescriptions: params.character_descriptions ? Object.keys(params.character_descriptions).length : 0,
      fromOverrides: params.character_overrides ? Object.keys(params.character_overrides).length : 0,
    });

    // ── 注册角色声音 ──
    const registered: string[] = [];
    const narrationProfile = await speakerManager.getOrCreateSpeaker(novelId, NARRATION_ROLE_NAME);
    registered.push(NARRATION_ROLE_NAME);

    for (const [roleName, portrait] of portraitMap) {
      const profile = await speakerManager.getOrCreateSpeaker(novelId, roleName, portrait);
      registered.push(roleName);
    }

    logger.info('角色声音注册完成', { registered: registered.length });

    return success({
      novel_id: novelId,
      characters_registered: registered,
      character_analysis: analysis.characters.map((c) => ({
        name: c.name, gender: c.gender, voice_description: c.voice_description,
      })),
      chapters_available: storedChapters.length,
    });
  });

  // ── 手动流程：按需合成章节音频 ──────────────────────
  app.post('/novel/synthesize', {
    schema: routeSchema({
      description: '对已上传并注册过角色声音的小说，按需合成指定章节的音频。支持选章节（按 ID 或标题）或整本合成。',
      tags: ['novel'],
      summary: '合成章节音频',
      body: {
        type: 'object', properties: {
          novel_id: { type: 'string', description: '小说 ID（与 novel_title 二选一）' },
          novel_title: { type: 'string', description: '小说名称（与 novel_id 二选一）' },
          chapter_ids: { type: 'array', items: { type: 'string' }, description: '章节 ID 列表（用于合成部分章节）' },
          chapter_titles: { type: 'array', items: { type: 'string' }, description: '章节标题列表（用于合成部分章节）' },
          all: { type: 'boolean', default: false, description: '是否合成全部章节' },
          output_format: { type: 'string', enum: ['wav', 'mp3', 'pcm'], default: 'mp3' },
          merge: { type: 'boolean', default: false, description: '是否合并为单个音频文件' },
          cache: { type: 'boolean', default: true, description: '是否使用音频缓存' },
        },
      },
      response: { '200': { description: '合成完成', data: {
        type: 'object', properties: {
          task_id: { type: 'string', format: 'uuid' },
          task_status: { type: 'string', enum: ['completed', 'processing'] },
          novel_id: { type: 'string' },
          chapters: { type: 'object' },
          merged_url: { type: 'string' },
        },
      } } },
    }),
  }, async (request, reply) => {
    const params = SynthesizeRequestSchema.parse(request.body);

    // ── 解析 novel_id ──
    let novelId = params.novel_id;
    if (!novelId && params.novel_title) {
      const novel = novelManager.getByTitle(params.novel_title);
      if (!novel) return reply.status(404).send(fail('小说未找到', 404));
      novelId = novel.id;
    }
    if (!novelId) return reply.status(400).send(fail('novel_id 或 novel_title 必填', 400));

    // ── 加载章节 ──
    let allChapters = novelManager.getChapters(novelId);
    if (allChapters.length === 0) {
      return reply.status(404).send(fail('该小说暂无章节记录，请先上传', 404));
    }

    // ── 筛选章节 ──
    let chaptersToSynthesize: typeof allChapters;
    if (params.all) {
      chaptersToSynthesize = allChapters;
    } else if (params.chapter_ids && params.chapter_ids.length > 0) {
      const idSet = new Set(params.chapter_ids);
      chaptersToSynthesize = allChapters.filter((c) => idSet.has(c.id));
      if (chaptersToSynthesize.length === 0) {
        return reply.status(404).send(fail('未找到匹配 chapter_ids 的章节', 404));
      }
    } else if (params.chapter_titles && params.chapter_titles.length > 0) {
      const titleSet = new Set(params.chapter_titles);
      chaptersToSynthesize = allChapters.filter((c) => titleSet.has(c.title));
      if (chaptersToSynthesize.length === 0) {
        return reply.status(404).send(fail('未找到匹配 chapter_titles 的章节', 404));
      }
    } else {
      return reply.status(400).send(fail('请指定 chapter_ids、chapter_titles 或设置 all: true', 400));
    }

    logger.info('开始按需合成', {
      novelId,
      totalChapters: allChapters.length,
      selectedChapters: chaptersToSynthesize.length,
    });

    // ── 加载角色声音映射 ──
    const speakers = speakerManager.listSpeakersByNovel(novelId);
    // 确保旁白在 speakerMap 中
    const narrationSpeaker = speakerManager.getSpeaker(novelId, NARRATION_ROLE_NAME)
      ?? await speakerManager.getOrCreateSpeaker(novelId, NARRATION_ROLE_NAME);

    const speakerMap = new Map<string, string>();
    speakerMap.set(NARRATION_ROLE_NAME, narrationSpeaker.speakerId);
    for (const sp of speakers) {
      speakerMap.set(sp.roleName, sp.speakerId);
    }

    if (speakerMap.size <= 1) {
      logger.warn('未找到角色声音，仅旁白可用', { novelId });
    }

    const fmt = params.output_format;
    const chapterResults: SynthesizeResult[] = [];
    const chapterAudioBuffers: Buffer[] = [];

    for (const chapter of chaptersToSynthesize) {
      const chContentHash = computeContentHash(chapter.content);

      // ── 缓存命中检查 ──
      if (params.cache !== false) {
        const cached = audioCache.getChapterAudio(novelId, chapter.title, chContentHash);
        if (cached) {
          chapterAudioBuffers.push(cached);
          chapterResults.push({
            title: chapter.title,
            chapter_id: chapter.id,
            duration_seconds: 0,
            url: '/' + novelId.slice(0, 8) + '-' + encodeURIComponent(chapter.title) + '.' + fmt,
          });
          continue;
        }
      }

      // ── 逐句合成 ──
      const chunks = textSplitter.parseRoles(chapter.content);
      const tempPath = audioCache.startChapterAudio(novelId, chapter.title, fmt);
      const segmentBuffers: Buffer[] = [];

      for (const chunk of chunks) {
        const speakerId = chunk.role
          ? (speakerMap.get(chunk.role) ?? speakerMap.get(NARRATION_ROLE_NAME)!)
          : speakerMap.get(NARRATION_ROLE_NAME)!;

        try {
          const audio = await cosyvoiceService.synthesizeWithSpeaker(chunk.text, speakerId, fmt);
          segmentBuffers.push(audio);
          audioCache.appendSegment(tempPath, audio);
        } catch (err) {
          logger.error('段落合成失败', {
            chapter: chapter.title, role: chunk.role ?? '旁白',
            text: chunk.text.slice(0, 20), error: String(err),
          });
        }
      }

      if (segmentBuffers.length === 0) {
        chapterResults.push({ title: chapter.title, chapter_id: chapter.id, duration_seconds: 0, url: '' });
        continue;
      }

      const mergedChapter = await audioMerger.merge(segmentBuffers, fmt);
      audioCache.finalizeChapterAudio(novelId, chapter.title, chContentHash, fmt, tempPath);
      chapterAudioBuffers.push(mergedChapter);
      chapterResults.push({
        title: chapter.title,
        chapter_id: chapter.id,
        duration_seconds: 0,
        url: '/' + novelId.slice(0, 8) + '-' + encodeURIComponent(chapter.title) + '.' + fmt,
      });
    }

    // ── 合并（可选） ──
    let finalUrl = '';
    if (params.merge && chapterAudioBuffers.length > 1) {
      try {
        const merged = await audioMerger.merge(chapterAudioBuffers, fmt);
        const mergedKey = novelId.slice(0, 8) + '-merged.' + fmt;
        audioCache.saveChapterAudio(
          novelId, '__merged__',
          computeContentHash(chapterAudioBuffers.map(b => b.length).join(',')),
          merged, fmt,
        );
        finalUrl = '/' + mergedKey;
      } catch (err) {
        logger.error('合并失败', { error: String(err) });
      }
    }

    const succeeded = chapterResults.filter((r) => r.url !== '').length;
    if (succeeded === 0) {
      return reply.status(500).send(fail('所有章节合成失败', 500));
    }

    const taskStatus = succeeded === chaptersToSynthesize.length ? 'completed' as const : 'processing' as const;

    return success({
      task_id: randomUUID(),
      task_status: taskStatus,
      novel_id: novelId,
      chapters: paginated(chapterResults),
      ...(finalUrl ? { merged_url: finalUrl } : {}),
    });
  });

  // ── 手动流程：重新注册单个角色声音 ──────────────────
  app.post('/novel/speakers/regenerate', {
    schema: routeSchema({
      description: '删除并重新生成指定角色的声音。适用于对当前音色不满意时重新生成。',
      tags: ['novel'],
      summary: '重新生成角色声音',
      body: {
        type: 'object', required: ['novel_id', 'role_name'], properties: {
          novel_id: { type: 'string', description: '小说 ID' },
          role_name: { type: 'string', description: '角色名' },
          portrait_override: { type: 'object', description: '可选的角色画像覆盖' },
        },
      },
      response: { '200': { description: '重新生成成功', data: {
        type: 'object', properties: {
          novel_id: { type: 'string' },
          role_name: { type: 'string' },
          base_voice: { type: 'string' },
          speaker_id: { type: 'string' },
        },
      } } },
    }),
  }, async (request, reply) => {
    const params = RegenerateSpeakerRequestSchema.parse(request.body);
    const { novel_id, role_name } = params;

    if (role_name === NARRATION_ROLE_NAME) {
      return reply.status(400).send(fail('旁白使用固定音色，不可重新生成', 400));
    }

    // 删除旧角色
    speakerManager.deleteSpeaker(novel_id, role_name);

    // 加载章节，分析角色，重新生成
    const storedChapters = novelManager.getChapters(novel_id);
    let portrait: CharacterPortrait | undefined;

    if (storedChapters.length > 0) {
      const analysis = await characterAnalyzer.analyze({
        chapters: storedChapters.map((c) => ({ title: c.title, content: c.content })),
      });
      portrait = analysis.characters.find((c) => c.name === role_name);
    }

    // 合并覆盖参数
    if (params.portrait_override && portrait) {
      Object.assign(portrait, params.portrait_override);
    } else if (params.portrait_override && !portrait) {
      portrait = {
        name: role_name,
        gender: params.portrait_override.gender ?? 'unknown',
        age: params.portrait_override.age ?? '',
        height: params.portrait_override.height ?? '',
        build: params.portrait_override.build ?? '',
        personality: params.portrait_override.personality ?? [],
        voice_description: params.portrait_override.voice_description ?? '',
        speaking_style: params.portrait_override.speaking_style ?? '',
        backstory_summary: params.portrait_override.backstory_summary ?? '',
      };
    }

    const profile = portrait
      ? await speakerManager.getOrCreateSpeaker(novel_id, role_name, portrait)
      : await speakerManager.getOrCreateSpeaker(novel_id, role_name);

    return success({
      novel_id,
      role_name: profile.roleName,
      base_voice: profile.baseVoice,
      speaker_id: profile.speakerId,
    });
  });
}










