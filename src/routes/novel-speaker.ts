import type { FastifyInstance } from "fastify";
import { routeSchema } from "../swagger-helper.js";
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
import { NARRATION_ROLE_NAME } from "../db/schema.js";
import type { CharacterPortrait } from "../schemas/character.schema.js";

export async function novelSpeakerRoutes(app: FastifyInstance) {
  // ── 角色列表 ──
  app.get("/characters", {
    schema: routeSchema({
      description: "列出角色列表，可按 novel_id 过滤",
      tags: ["character"],
      summary: "角色列表",
      querystring: {
        type: "object",
        properties: {
          novel_id: { type: "string", description: "小说 ID（可选，不传则返回全部角色）" },
        },
      },
      response: {
        "200": {
          description: "查询成功",
          data: {
            type: "object",
            properties: { characters: { type: "object" } },
          },
        },
      },
    }),
  }, async (request) => {
    const q = request.query as Record<string, string>;
    if (q.novel_id) {
      const { novel_id } = CharacterQuerySchema.parse(q);
      return success({ characters: paginated(speakerManager.listSpeakersByNovel(novel_id)) });
    }
    return success({ characters: paginated(speakerManager.listAllSpeakers()) });
  });

  // ── 删除角色 ──
  app.post("/characters/delete", {
    schema: routeSchema({
      description: "删除指定小说的指定角色",
      tags: ["character"],
      summary: "删除角色",
      body: {
        type: "object",
        required: ["novel_id", "role_name"],
        properties: {
          novel_id: { type: "string", description: "小说 ID" },
          role_name: { type: "string", description: "角色名" },
        },
      },
      response: {
        "200": { description: "删除成功", data: { type: "object", properties: { role_name: { type: "string" } } } },
        "404": { description: "角色未找到" },
      },
    }),
  }, async (request, reply) => {
    const { novel_id, role_name } = CharacterDeleteSchema.parse(request.body);
    const deleted = speakerManager.deleteSpeaker(novel_id, role_name);
    if (!deleted) return reply.status(404).send(fail("角色未找到", 404));
    return success({ role_name });
  });

  // ── 注册角色声音 ──
  app.post("/novel/speakers/register", {
    schema: routeSchema({
      description: "从已存储的章节中通过 LLM 分析角色，注册所有角色声音到 CosyVoice。这是手动流程的第一步，需先上传小说文本。",
      tags: ["novel"],
      summary: "注册角色声音",
      body: {
        type: "object",
        properties: {
          novel_id: { type: "string", description: "小说 ID（与 novel_title 二选一）" },
          novel_title: { type: "string", description: "小说名称（与 novel_id 二选一）" },
          character_descriptions: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "可选的角色声音描述",
          },
          character_overrides: {
            type: "object",
            description: "可选的角色画像覆盖",
          },
        },
      },
      response: {
        "200": {
          description: "注册完成",
          data: {
            type: "object",
            properties: {
              novel_id: { type: "string" },
              characters_registered: { type: "array", items: { type: "string" } },
              character_analysis: { type: "array", items: { type: "object" } },
              chapters_available: { type: "integer" },
            },
          },
        },
      },
    }),
  }, async (request, reply) => {
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
      .map((s) => s.roleName)
      .filter((n) => n !== NARRATION_ROLE_NAME);

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
            name, gender: "unknown", age: "", height: "", build: "",
            personality: [], voice_description: desc, speaking_style: "", backstory_summary: "",
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
    const narrationProfile = await speakerManager.getOrCreateSpeaker(novelId, NARRATION_ROLE_NAME);
    registered.push(NARRATION_ROLE_NAME);

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
  app.post("/novel/speakers/regenerate", {
    schema: routeSchema({
      description: "删除并重新生成指定角色的声音。适用于对当前音色不满意时重新生成。",
      tags: ["novel"],
      summary: "重新生成角色声音",
      body: {
        type: "object",
        required: ["novel_id", "role_name"],
        properties: {
          novel_id: { type: "string", description: "小说 ID" },
          role_name: { type: "string", description: "角色名" },
          portrait_override: { type: "object", description: "可选的角色画像覆盖" },
        },
      },
      response: {
        "200": {
          description: "重新生成成功",
          data: {
            type: "object",
            properties: {
              novel_id: { type: "string" },
              role_name: { type: "string" },
              base_voice: { type: "string" },
              speaker_id: { type: "string" },
            },
          },
        },
      },
    }),
  }, async (request, reply) => {
    const params = RegenerateSpeakerRequestSchema.parse(request.body);
    const { novel_id, role_name } = params;

    if (role_name === NARRATION_ROLE_NAME) {
      return reply.status(400).send(fail("旁白使用固定音色，不可重新生成", 400));
    }

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

