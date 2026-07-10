/**
 * ── 角色分析 ──
 * POST /novel/analyze            → 对已有章节做 LLM 角色分析（不注册声音）。
 * POST /novel/upload-and-analyze → 上传文本 + 解析章节 + 角色分析一站式。
 */
import type { FastifyInstance } from "fastify";
import { parseUploadRequest } from "../utils/request-parser.js";
import { success, fail, paginated } from "../utils/response.js";
import { logger } from "../utils/logger.js";
import { speakerManager } from "../services/speaker_manager.js";
import { novelManager } from "../services/novel_manager.js";
import { characterAnalyzer } from "../services/character_analyzer.js";
import { AnalyzeRequestSchema } from "../schemas/novel.schema.js";
import { textSplitter } from "../services/text_splitter.js";
import { UploadAndAnalyzeRequestSchema } from "../schemas/novel.schema.js";
import { NARRATION_ROLE_NAME } from "../db/schema.js";
import type { CharacterPortrait } from "../schemas/character.schema.js";
import {
  analyzeCharactersSchema,
  uploadAndAnalyzeSchema,
} from "../route-schemas/novel-analyze.schema.js";

export async function novelAnalyzeRoutes(app: FastifyInstance) {
  app.post("/novel/analyze", { schema: analyzeCharactersSchema }, async (request) => {
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



  // ── 上传并分析角色（一站式） ──
  app.post("/novel/upload-and-analyze", { schema: uploadAndAnalyzeSchema }, async (request, reply) => {
    console.log("request.body", request.body);
    const { fields, fileContent } = await parseUploadRequest(request);
    const content = fileContent ?? fields["content"] ?? "";
    if (!content) {
      return reply.status(422).send(fail("请提供小说内容（JSON 的 content 字段或 multipart 的 file 字段）", 422));
    }
    let charDescriptions: Record<string, string> | undefined;
    if (fields["character_descriptions"]) {
      try { charDescriptions = JSON.parse(fields["character_descriptions"]); } catch {}
    }

    const params = UploadAndAnalyzeRequestSchema.parse({
      novel_title: fields["novel_title"],
      content,
      character_descriptions: charDescriptions,
    });

    // 1. 解析章节
    const chapters = textSplitter.parseChaptersFromText(params.content);
    logger.info("上传文本解析完成", {
      novel_title: params.novel_title,
      chapter_count: chapters.length,
      total_chars: params.content.length,
    });

    // 2. 保存章节
    const novel = novelManager.getOrCreate(params.novel_title);
    novelManager.saveChapters(novel.id, chapters);

    // 3. 角色分析
    const existingSpeakers = speakerManager.listSpeakersByNovel(novel.id);
    const existingNames = existingSpeakers
      .map((s) => s.roleName)
      .filter((n) => n !== NARRATION_ROLE_NAME);

    const analysis = await characterAnalyzer.analyze({
      chapters: chapters.map((c) => ({ title: c.title, content: c.content })),
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

    logger.info("上传并分析角色完成", {
      novel_title: params.novel_title,
      chapter_count: chapters.length,
      character_count: characters.length,
    });

    return success({
      novel_title: params.novel_title,
      chapters: paginated(chapters),
      characters: paginated(characters),
    });
  });
}
