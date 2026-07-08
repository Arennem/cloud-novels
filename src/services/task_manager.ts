import { randomUUID } from "crypto";
import { getDb } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { speakerManager } from "./speaker_manager.js";
import { novelManager } from "./novel_manager.js";
import { characterAnalyzer } from "./character_analyzer.js";
import { cosyvoiceService } from "./cosyvoice.js";
import { audioMerger } from "./audio_merger.js";
import { annotationManager } from "./annotation_manager.js";
import { audioCache, computeContentHash } from "./audio_cache.js";
import { NARRATION_ROLE_NAME } from "../db/schema.js";
import type { CharacterPortrait } from "../schemas/character.schema.js";


/* ───────── 通知辅助 ───────── */
function pushNotification(
  novelId: string,
  taskId: string,
  type: string,
  title: string,
  message?: string,
  data?: unknown,
) {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO notifications (id, novel_id, task_id, type, title, message, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, novelId, taskId, type, title, message ?? null, data ? JSON.stringify(data) : null, now);
  } catch (err) {
    logger.error("写入通知失败", { taskId, error: String(err) });
  }
}
/* ───────── 类型 ───────── */
interface SpeakerInfo {
  speakerId: string;
  portrait: CharacterPortrait | null;
}

export type TaskType = "convert" | "synthesize";
export type TaskStatus = "pending" | "processing" | "completed" | "partial" | "failed";
export type ChapterStatus = "pending" | "annotating" | "synthesizing" | "merging" | "completed" | "failed" | "cached";

export interface TaskChapterRow {
  id: string;
  task_id: string;
  chapter_title: string;
  sort_order: number;
  status: ChapterStatus;
  output_url: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  segment_count: number | null;
  content_hash: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  novel_id: string;
  task_type: TaskType;
  status: TaskStatus;
  output_format: string;
  merge: number;
  total_chapters: number;
  completed_chapters: number;
  failed_chapters: number;
  merged_url: string | null;
  characters_registered: string | null;
  character_analysis: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskDetail {
  id: string;
  novel_id: string;
  task_type: TaskType;
  status: TaskStatus;
  output_format: string;
  merge: boolean;
  total_chapters: number;
  completed_chapters: number;
  failed_chapters: number;
  merged_url: string | null;
  characters_registered: string[] | null;
  character_analysis: unknown[] | null;
  chapters: {
    title: string;
    sort_order: number;
    status: ChapterStatus;
    output_url: string | null;
    duration_seconds: number | null;
    error_message: string | null;
  }[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/* ───────── 任务调度器 ───────── */
export class TaskManager {
  /**
   * 创建任务并后台执行。
   * 立即返回 task_id，通过 setImmediate 异步处理。
   */
  createAndRun(params: {
    novelId: string;
    taskType: TaskType;
    chapterTitles: string[];
    outputFormat: "wav" | "mp3" | "pcm";
    merge: boolean;
    characterDescriptions?: Record<string, string>;
    characterOverrides?: Record<string, Partial<CharacterPortrait>>;
  }): string {
    const db = getDb();
    const taskId = randomUUID();
    const now = new Date().toISOString();

    // 创建任务
    db.prepare(`
      INSERT INTO synthesis_tasks (id, novel_id, task_type, status, output_format, merge, total_chapters, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(taskId, params.novelId, params.taskType, params.outputFormat, params.merge ? 1 : 0, params.chapterTitles.length, now, now);

    // 创建章节子任务
    const insertChapter = db.prepare(`
      INSERT INTO task_chapters (id, task_id, chapter_title, sort_order, status, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `);

    for (let i = 0; i < params.chapterTitles.length; i++) {
      const chId = randomUUID();
      insertChapter.run(chId, taskId, params.chapterTitles[i], i, "", now, now);
    }

    logger.info("合成任务已创建", { taskId, novelId: params.novelId, chapters: params.chapterTitles.length });

    // 后台执行（不阻塞响应）
    setImmediate(() => {
      this.processTask(taskId, params).catch((err) => {
        logger.error("任务处理异常", { taskId, error: String(err) });
      });
    });

    return taskId;
  }

  /**
   * 后台处理任务：逐章标注 → 合成 → 合并。
   */
  private async processTask(
    taskId: string,
    params: {
      novelId: string;
      taskType: TaskType;
      chapterTitles: string[];
      outputFormat: "wav" | "mp3" | "pcm";
      merge: boolean;
      characterDescriptions?: Record<string, string>;
      characterOverrides?: Record<string, Partial<CharacterPortrait>>;
    },
  ): Promise<void> {
    const db = getDb();
    const { novelId, outputFormat: fmt } = params;
    const now = new Date().toISOString();

    // ── 标记 processing ──
    db.prepare(`
      UPDATE synthesis_tasks SET status = 'processing', updated_at = ? WHERE id = ?
    `).run(now, taskId);

    // ── 准备 speakerInfoMap ──
    let speakerInfoMap = new Map<string, SpeakerInfo>();

    if (params.taskType === "convert") {
      // convert 模式：LLM 分析 → 注册 → 合成
      try {
        const existingSpeakers = speakerManager.listSpeakersByNovel(novelId);
        const existingNames = existingSpeakers
          .map((s) => s.roleName)
          .filter((n) => n !== NARRATION_ROLE_NAME);

        // 加载章节内容
        const allChapters = novelManager.getChapters(novelId);
        const chapterMap = new Map(allChapters.map((c) => [c.title, c]));

        const chaptersToAnalyze = params.chapterTitles
          .map((t) => chapterMap.get(t))
          .filter((c): c is NonNullable<typeof c> => !!c);

        const analysis = await characterAnalyzer.analyze({
          chapters: chaptersToAnalyze.map((c) => ({ title: c.title, content: c.content })),
          existingCharacters: existingNames,
        });

        const portraitMap = buildPortraitMap(analysis, params.characterDescriptions, params.characterOverrides);

        logger.info("角色画像准备完成", { taskId, fromLLM: analysis.characters.length });
        const { registered, speakerInfoMap: sim } = await registerSpeakers(novelId, portraitMap);
        speakerInfoMap = sim;

        // 存任务元数据
        db.prepare(`
          UPDATE synthesis_tasks
          SET characters_registered = ?, character_analysis = ?, updated_at = ?
          WHERE id = ?
        `).run(
          JSON.stringify(registered),
          JSON.stringify(analysis.characters.map((c) => ({
            name: c.name, gender: c.gender, voice_description: c.voice_description,
          }))),
          now, taskId,
        );
      } catch (err) {
        logger.error("角色分析/注册失败", { taskId, error: String(err) });
        db.prepare(`
          UPDATE synthesis_tasks SET status = 'failed', updated_at = ?, completed_at = ? WHERE id = ?
        `).run(now, now, taskId);
        pushNotification(params.novelId, taskId, "task_failed",
          "合成任务失败",
          "角色分析/注册阶段出错");
        return;
      }
    } else {
      // synthesize 模式：从已注册角色构建 map
      const speakers = speakerManager.listSpeakersByNovel(novelId);
      const narrationSpeaker = speakerManager.getSpeaker(novelId, NARRATION_ROLE_NAME)
        ?? await speakerManager.getOrCreateSpeaker(novelId, NARRATION_ROLE_NAME);
      speakerInfoMap.set(NARRATION_ROLE_NAME, { speakerId: narrationSpeaker.speakerId, portrait: null });
      for (const sp of speakers) {
        speakerInfoMap.set(sp.roleName, { speakerId: sp.speakerId, portrait: sp.portrait });
      }
    }

    // ── 逐章处理 ──
    const allChapters = novelManager.getChapters(novelId);
    const chapterMap = new Map(allChapters.map((c) => [c.title, c]));
    const chapterAudioBuffers: Buffer[] = [];

    for (let i = 0; i < params.chapterTitles.length; i++) {
      const title = params.chapterTitles[i];

      // 查找对应 task_chapter 行
      const tcRows = db.prepare(
        "SELECT * FROM task_chapters WHERE task_id = ? AND chapter_title = ?"
      ).all(taskId, title) as TaskChapterRow[];

      if (tcRows.length === 0) {
        logger.warn("task_chapter 行未找到，跳过", { taskId, chapter: title });
        continue;
      }
      const tcId = tcRows[0].id;
      const chapter = chapterMap.get(title);
      if (!chapter) {
        this.updateChapterStatus(db, tcId, "failed", "章节内容未找到");
        continue;
      }

      const chContentHash = computeContentHash(chapter.content);
      const useCache = true;

      // ── 缓存检查 ──
      const cached = audioCache.getChapterAudio(novelId, title, chContentHash);
      if (cached && useCache) {
        chapterAudioBuffers.push(cached);
        db.prepare(`
          UPDATE task_chapters SET status = 'cached', content_hash = ?, output_url = ?, updated_at = ? WHERE id = ?
        `).run(chContentHash, "/" + novelId.slice(0, 8) + "-" + encodeURIComponent(title) + "." + fmt, now, tcId);
        this.incrementCompleted(db, taskId);
        logger.info("章节缓存命中", { taskId, chapter: title });
        pushNotification(params.novelId, taskId, "chapter_cached",
          "章节「" + title + "」命中缓存",
          undefined, { chapter_title: title });
        continue;
      }

      // ── 标注 ──
      db.prepare(`
        UPDATE task_chapters SET status = 'annotating', content_hash = ?, started_at = ?, updated_at = ? WHERE id = ?
      `).run(chContentHash, now, now, tcId);

      const annotationResult = await annotationManager.annotate(novelId, title, chapter.content);
      if (annotationResult.status !== "done") {
        const errMsg = annotationResult.error ?? "标注失败";
        this.updateChapterFailed(db, taskId, tcId, errMsg);
        continue;
      }

      const segments = annotationResult.segments!;

      // ── 合成 ──
      db.prepare(`
        UPDATE task_chapters SET status = 'synthesizing', updated_at = ? WHERE id = ?
      `).run(now, tcId);

      const narrationInfo = speakerInfoMap.get(NARRATION_ROLE_NAME)!;
      const tempPath = audioCache.startChapterAudio(novelId, title, fmt);
      const segmentBuffers: Buffer[] = [];
      let allFailed = true;

      for (const segment of segments) {
        const role = segment.speaker;
        const info = speakerInfoMap.get(role) ?? narrationInfo;
        const ttsParams: { emotion?: string; speed?: number } = {};
        if (segment.emotion) {
          ttsParams.emotion = segment.emotion;
        } else if (info.portrait) {
          Object.assign(ttsParams, characterAnalyzer.deriveSynthesisParams(info.portrait));
        }

        try {
          const audio = await cosyvoiceService.synthesizeWithSpeaker(
            segment.text, info.speakerId, fmt, ttsParams,
          );
          audioCache.appendSegment(tempPath, audio);
          segmentBuffers.push(audio);
          allFailed = false;
        } catch (err) {
          logger.error("段落合成失败", {
            taskId, chapter: title, role,
            text: segment.text.slice(0, 20), error: String(err),
          });
        }
      }

      if (allFailed) {
        this.updateChapterFailed(db, taskId, tcId, "所有段落合成失败");
        continue;
      }

      // ── 合并 ──
      db.prepare(`
        UPDATE task_chapters SET status = 'merging', updated_at = ? WHERE id = ?
      `).run(now, tcId);

      const mergedChapter = await audioMerger.merge(segmentBuffers, fmt);
      audioCache.finalizeChapterAudio(novelId, title, chContentHash, fmt, tempPath);
      chapterAudioBuffers.push(mergedChapter);

      const outputUrl = "/" + novelId.slice(0, 8) + "-" + encodeURIComponent(title) + "." + fmt;
      db.prepare(`
        UPDATE task_chapters
        SET status = 'completed', output_url = ?, segment_count = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(outputUrl, segments.length, now, now, tcId);

      this.incrementCompleted(db, taskId);
      logger.info("章节合成完成", { taskId, chapter: title, segments: segments.length });
        pushNotification(params.novelId, taskId, "chapter_completed",
          "章节「" + title + "」合成完成",
          segments.length + " 段语音已合成",
          { chapter_title: title, segments: segments.length, output_url: outputUrl });
    }

    // ── 可选合并全书 ──
    let mergedUrl = "";
    if (params.merge && chapterAudioBuffers.length > 1) {
      try {
        const merged = await audioMerger.merge(chapterAudioBuffers, fmt);
        const mergedKey = novelId.slice(0, 8) + "-merged." + fmt;
        audioCache.saveChapterAudio(
          novelId, "__merged__",
          computeContentHash(chapterAudioBuffers.map((b) => b.length).join(",")),
          merged, fmt,
        );
        mergedUrl = "/" + mergedKey;
      } catch (err) {
        logger.error("全书合并失败", { taskId, error: String(err) });
      }
    }

    // ── 最终状态 ──
    const taskRows = db.prepare(
      "SELECT * FROM synthesis_tasks WHERE id = ?"
    ).get(taskId) as TaskRow;

    const finalStatus: TaskStatus =
      taskRows.failed_chapters === taskRows.total_chapters ? "failed"
        : taskRows.completed_chapters + taskRows.failed_chapters >= taskRows.total_chapters ? "completed"
          : "partial";

    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE synthesis_tasks
      SET status = ?, merged_url = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(finalStatus, mergedUrl || null, completedAt, completedAt, taskId);

    pushNotification(params.novelId, taskId, finalStatus === "completed" ? "task_completed" : finalStatus === "partial" ? "task_partial" : "task_failed",
          "合成任务" + (finalStatus === "completed" ? "完成" : finalStatus === "partial" ? "部分完成" : "失败"),
          taskRows.completed_chapters + "/" + taskRows.total_chapters + " 章合成成功，" + taskRows.failed_chapters + " 章失败",
          finalStatus === "completed" && mergedUrl ? { merged_url: mergedUrl } : undefined);
        logger.info("合成任务完成", { taskId, status: finalStatus, completed: taskRows.completed_chapters, failed: taskRows.failed_chapters, total: taskRows.total_chapters });
  }

  // ── 查询 ──

  /** 查单个任务详情 */
  getTask(taskId: string): TaskDetail | null {
    const db = getDb();
    const task = db.prepare("SELECT * FROM synthesis_tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
    if (!task) return null;

    const chapters = db.prepare(
      "SELECT * FROM task_chapters WHERE task_id = ? ORDER BY sort_order"
    ).all(taskId) as TaskChapterRow[];

    return {
      id: task.id,
      novel_id: task.novel_id,
      task_type: task.task_type,
      status: task.status,
      output_format: task.output_format,
      merge: task.merge === 1,
      total_chapters: task.total_chapters,
      completed_chapters: task.completed_chapters,
      failed_chapters: task.failed_chapters,
      merged_url: task.merged_url,
      characters_registered: task.characters_registered ? JSON.parse(task.characters_registered) : null,
      character_analysis: task.character_analysis ? JSON.parse(task.character_analysis) : null,
      chapters: chapters.map((c) => ({
        title: c.chapter_title,
        sort_order: c.sort_order,
        status: c.status,
        output_url: c.output_url,
        duration_seconds: c.duration_seconds,
        error_message: c.error_message,
      })),
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
    };
  }

  /** 查小说的任务列表 */
  listTasks(novelId: string, limit = 20): TaskRow[] {
    const db = getDb();
    return db.prepare(
      "SELECT * FROM synthesis_tasks WHERE novel_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(novelId, limit) as TaskRow[];
  }

  // ── 内部辅助 ──

  private updateChapterStatus(db: ReturnType<typeof getDb>, tcId: string, status: ChapterStatus, error?: string) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE task_chapters SET status = ?, error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?
    `).run(status, error ?? null, now, now, tcId);
  }

  private updateChapterFailed(db: ReturnType<typeof getDb>, taskId: string, tcId: string, error: string) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE task_chapters SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?
    `).run(error, now, now, tcId);
    db.prepare(`
      UPDATE synthesis_tasks SET failed_chapters = failed_chapters + 1, updated_at = ? WHERE id = ?
    `).run(now, taskId);
  }

  private incrementCompleted(db: ReturnType<typeof getDb>, taskId: string) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE synthesis_tasks SET completed_chapters = completed_chapters + 1, updated_at = ? WHERE id = ?
    `).run(now, taskId);
  }
}

/* ───────── 纯函数辅助 ───────── */

function buildPortraitMap(
  analysis: { characters: CharacterPortrait[] },
  characterDescriptions?: Record<string, string>,
  characterOverrides?: Record<string, Partial<CharacterPortrait>>,
): Map<string, CharacterPortrait> {
  const map = new Map<string, CharacterPortrait>();
  for (const c of analysis.characters) {
    if (c.name === NARRATION_ROLE_NAME) continue;
    map.set(c.name, { ...c });
  }
  if (characterDescriptions) {
    for (const [name, desc] of Object.entries(characterDescriptions)) {
      if (name === NARRATION_ROLE_NAME) continue;
      const existing = map.get(name);
      if (existing) {
        if (!existing.voice_description) existing.voice_description = desc;
      } else {
        map.set(name, {
          name, gender: "unknown", age: "", height: "", build: "",
          personality: [], voice_description: desc, speaking_style: "", backstory_summary: "",
        });
      }
    }
  }
  if (characterOverrides) {
    for (const [name, overrides] of Object.entries(characterOverrides)) {
      if (name === NARRATION_ROLE_NAME) continue;
      const existing = map.get(name);
      if (existing) {
        Object.assign(existing, overrides);
      } else {
        map.set(name, {
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
  return map;
}

async function registerSpeakers(
  novelId: string,
  portraitMap: Map<string, CharacterPortrait>,
): Promise<{ registered: string[]; speakerInfoMap: Map<string, SpeakerInfo> }> {
  const registered: string[] = [];
  const speakerInfoMap = new Map<string, SpeakerInfo>();
  const narrationProfile = await speakerManager.getOrCreateSpeaker(novelId, NARRATION_ROLE_NAME);
  speakerInfoMap.set(NARRATION_ROLE_NAME, { speakerId: narrationProfile.speakerId, portrait: null });
  registered.push(NARRATION_ROLE_NAME);
  for (const [roleName, portrait] of portraitMap) {
    const profile = await speakerManager.getOrCreateSpeaker(novelId, roleName, portrait);
    speakerInfoMap.set(roleName, { speakerId: profile.speakerId, portrait });
    registered.push(roleName);
  }
  return { registered, speakerInfoMap };
}

export const taskManager = new TaskManager();

