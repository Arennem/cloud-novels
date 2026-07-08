import type { FastifyInstance } from "fastify";
import { routeSchema } from "../swagger-helper.js";
import { success, paginated } from "../utils/response.js";
import { logger } from "../utils/logger.js";
import { speakerManager } from "../services/speaker_manager.js";
import { novelManager } from "../services/novel_manager.js";
import { characterAnalyzer } from "../services/character_analyzer.js";
import { AnalyzeRequestSchema } from "../schemas/novel.schema.js";
import { NARRATION_ROLE_NAME } from "../db/schema.js";
import type { CharacterPortrait } from "../schemas/character.schema.js";

export async function novelAnalyzeRoutes(app: FastifyInstance) {
  app.post("/novel/analyze", {
    schema: routeSchema({
      description: "对已有章节进行 LLM 角色分析，不含语音合成",
      tags: ["novel"],
      summary: "角色分析",
      body: {
        type: "object",
        required: ["novel_title", "chapters"],
        properties: {
          novel_title: { type: "string", description: "小说名称" },
          chapters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                content: { type: "string" },
              },
            },
            description: "章节列表",
          },
          character_descriptions: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "可选的角色声音描述，key 为角色名，value 为声音特征描述",
          },
        },
      },
      response: {
        "200": {
          description: "分析完成",
          data: {
            type: "object",
            properties: {
              characters: {
                type: "object",
                properties: {
                  total: { type: "integer" },
                  list: { type: "array", items: { type: "object" } },
                  pageNum: { type: "integer" },
                  pageSize: { type: "integer" },
                },
              },
            },
          },
        },
      },
    }),
  }, async (request) => {
    const params = AnalyzeRequestSchema.parse(request.body);

    logger.info("开始独立角色分析", {
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
            name,
            gender: "unknown",
            age: "",
            height: "",
            build: "",
            personality: [],
            voice_description: desc,
            speaking_style: "",
            backstory_summary: "",
          });
        }
      }
    }

    const characters = [...portraitMap.values()];

    logger.info("角色分析完成", {
      novel_title: params.novel_title,
      character_count: characters.length,
      fromLLM: analysis.characters.length,
      fromDescriptions: params.character_descriptions
        ? Object.keys(params.character_descriptions).length
        : 0,
    });

    return success({ characters: paginated(characters) });
  });
}
