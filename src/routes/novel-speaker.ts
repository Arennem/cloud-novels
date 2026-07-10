/**
 * ── 角色 / Speaker 管理 ──
 * GET  /characters                   → 角色列表（分页，可按 novel_id 过滤）。
 * GET  /characters/detail            → 角色详情，含 portrait / voice_prompt。
 * POST /characters/update            → 手动微调角色画像。
 * POST /characters/delete            → 删除角色。
 * POST /novel/speakers/register      → 分析章节 → 注册声音（走 CosyVoice clone）。
 * POST /novel/speakers/regenerate    → 重新生成指定角色的声音（可覆盖画像）。
 */
import type { FastifyInstance } from "fastify";
import { success, fail, paginated } from "../utils/response.js";
import { logger } from "../utils/logger.js";
import { speakerManager } from "../services/speaker_manager.js";
import { novelManager } from "../services/novel_manager.js";
import { characterAnalyzer } from "../services/character_analyzer.js";
import {
  RegisterSpeakersRequestSchema,
  RegenerateSpeakerRequestSchema,
} from "../schemas/novel.schema.js";
import { CharacterQuerySchema, CharacterDeleteSchema } from "../schemas/novel.schema.js";
import { PaginationSchema } from "../schemas/common.schema.js";
import type { CharacterPortrait } from "../schemas/character.schema.js";
import {
  characterListSchema,
  characterDeleteSchema as charDeleteRouteSchema,
  characterDetailSchema,
  characterUpdateSchema,
  registerSpeakersSchema,
  regenerateSpeakerSchema,
} from "../route-schemas/novel-speaker.schema.js";

export async function novelSpeakerRoutes(app: FastifyInstance) {
  // ── 角色列表（分页） ──
  app.get("/characters", { schema: characterListSchema }, async (request) => {
    const q = request.query as Record<string, string>;
    const { pageNum, pageSize } = PaginationSchema.parse(request.query);
    if (q.novel_id) {
      const { novel_id } = CharacterQuerySchema.parse(q);
      return success({ characters: paginated(speakerManager.listSpeakersByNovel(novel_id), undefined, pageNum, pageSize) });
    }
    return success({ characters: paginated(speakerManager.listAllSpeakers(), undefined, pageNum, pageSize) });
  });

  // ── 删除角色 ──
  app.post("/characters/delete", { schema: charDeleteRouteSchema }, async (request, reply) => {
    const { novel_id, role_name } = CharacterDeleteSchema.parse(request.body);
    const deleted = speakerManager.deleteSpeaker(novel_id, role_name);
    if (!deleted) return reply.status(404).send(fail("角色未找到", 404));
    return success({ role_name });
  });

  // ── 角色详情 ──
  app.get("/characters/detail", { schema: characterDetailSchema }, async (request, reply) => {
    const q = request.query as Record<string, string>;
    const { novel_id, role_name } = q;
    if (!novel_id || !role_name) return reply.status(400).send(fail("novel_id 和 role_name 必填", 400));
    const speaker = speakerManager.getSpeaker(novel_id, role_name);
    if (!speaker) return reply.status(404).send(fail("角色未找到", 404));
    // 返回完整的角色信息，包括 portrait（含 voice_prompt）
    return success({
      novel_id: speaker.novelId,
      role_name: speaker.roleName,
      base_voice: speaker.baseVoice,
      speaker_id: speaker.speakerId,
      description: speaker.description,
      sample_audio_url: speaker.sampleAudioPath,
      portrait: speaker.portrait,
    });
  });

  // ── 更新角色画像（人工微调） ──
  app.post("/characters/update", { schema: characterUpdateSchema }, async (request, reply) => {
    const body = request.body as { novel_id: string; role_name: string; portrait: CharacterPortrait };
    const { novel_id, role_name } = body;
    // 检查角色是否存在
    const existing = speakerManager.getSpeaker(novel_id, role_name);
    if (!existing) return reply.status(404).send(fail("角色未找到", 404));
    // 检查 voice_prompt 长度
    if (body.portrait.voice_prompt && body.portrait.voice_prompt.length > 500) {
      logger.warn("voice_prompt 超过 500 字符", { length: body.portrait.voice_prompt.length });
    }
    const updated = speakerManager.updateSpeakerPortrait(novel_id, role_name, body.portrait);
    if (!updated) return reply.status(500).send(fail("更新失败", 500));
    return success({ novel_id, role_name });
  });

  // ── 注册角色声音 ──
  app.post("/novel/speakers/register", { schema: registerSpeakersSchema }, async (request, reply) => {
    const params = RegisterSpeakersRequestSchema.parse(request.body);

    let novelId = params.novel_id;
    if (!novelId && params.novel_title) {
      const novel = novelManager.getByTitle(params.novel_title);
      if (!novel) return reply.status(404).send(fail("小说未找到，请先上传", 404));
      novelId = novel.id;
    }
    if (!novelId) return reply.status(400).send(fail("novel_id 或 novel_title 必填", 400));

    const storedChapters = novelManager.getChapters(novelId);
    if (storedChapters.length === 0) {
      return reply.status(404).send(fail("该小说暂无章节记录，请先上传", 404));
    }
    logger.info("从存储加载章节", { novelId, chapters: storedChapters.length });

    const existingSpeakers = speakerManager.listSpeakersByNovel(novelId);
    const existingNames = existingSpeakers
      .map((s) => s.roleName);

    const analysis = await characterAnalyzer.analyze({
      chapters: storedChapters.map((c) => ({ title: c.title, content: c.content })),
      existingCharacters: existingNames,
    });

    const portraitMap = new Map<string, CharacterPortrait>();
    for (const c of analysis.characters) {
      portraitMap.set(c.name, c);
    }
    if (params.character_descriptions) {
      for (const [name, desc] of Object.entries(params.character_descriptions)) {
        const existing = portraitMap.get(name);
        if (existing) {
          if (!existing.voice_description) existing.voice_description = desc;
        } else {
          portraitMap.set(name, {
            name, gender: "unknown", age: "", height: "", build: "",
            personality: [], voice_description: desc, speaking_style: "", backstory_summary: "",
          });
        }
      }
    }
    if (params.character_overrides) {
      for (const [name, overrides] of Object.entries(params.character_overrides)) {
        const existing = portraitMap.get(name);
        if (existing) {
          Object.assign(existing, overrides);
        } else {
          portraitMap.set(name, {
            name,
            gender: overrides.gender ?? "unknown",
            age: overrides.age ?? "",
            height: overrides.height ?? "",
            build: overrides.build ?? "",
            personality: overrides.personality ?? [],
            voice_description: overrides.voice_description ?? "",
            speaking_style: overrides.speaking_style ?? "",
            backstory_summary: overrides.backstory_summary ?? "",
          });
        }
      }
    }

    logger.info("角色画像准备完成", {
      fromLLM: analysis.characters.length,
      fromDescriptions: params.character_descriptions ? Object.keys(params.character_descriptions).length : 0,
      fromOverrides: params.character_overrides ? Object.keys(params.character_overrides).length : 0,
    });

    const registered: string[] = [];

    for (const [roleName, portrait] of portraitMap) {
      await speakerManager.getOrCreateSpeaker(novelId, roleName, portrait);
      registered.push(roleName);
    }

    logger.info("角色声音注册完成", { registered: registered.length });

    return success({
      novel_id: novelId,
      characters_registered: registered,
      character_analysis: analysis.characters.map((c) => ({
        name: c.name, gender: c.gender, voice_description: c.voice_description,
      })),
      chapters_available: storedChapters.length,
    });
  });

  // ── 重新生成角色声音 ──
  app.post("/novel/speakers/regenerate", { schema: regenerateSpeakerSchema }, async (request, reply) => {
    const params = RegenerateSpeakerRequestSchema.parse(request.body);
    const { novel_id, role_name } = params;


    speakerManager.deleteSpeaker(novel_id, role_name);

    const storedChapters = novelManager.getChapters(novel_id);
    let portrait: CharacterPortrait | undefined;

    if (storedChapters.length > 0) {
      const analysis = await characterAnalyzer.analyze({
        chapters: storedChapters.map((c) => ({ title: c.title, content: c.content })),
      });
      portrait = analysis.characters.find((c) => c.name === role_name);
    }

    if (params.portrait_override && portrait) {
      Object.assign(portrait, params.portrait_override);
    } else if (params.portrait_override && !portrait) {
      portrait = {
        name: role_name,
        gender: params.portrait_override.gender ?? "unknown",
        age: params.portrait_override.age ?? "",
        height: params.portrait_override.height ?? "",
        build: params.portrait_override.build ?? "",
        personality: params.portrait_override.personality ?? [],
        voice_description: params.portrait_override.voice_description ?? "",
        speaking_style: params.portrait_override.speaking_style ?? "",
        backstory_summary: params.portrait_override.backstory_summary ?? "",
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
