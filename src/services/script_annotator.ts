import { logger } from "../utils/logger.js";
import { chat } from "./llm.js";
import { ChapterAnnotationSchema } from "../schemas/annotation.schema.js";
import { ZodError } from "zod";
import { SCRIPT_ANNOTATOR_PROMPT, MAX_RETRIES } from '../constants/index.js';

/* ───────── 系统提示 ───────── */


/* ───────── 最大重试次数 ───────── */

export class ScriptAnnotator {
  /**
   * 对一章原始文本进行 LLM 标注，返回结构化片段列表。
   * 解析失败时自动重试（最多 MAX_RETRIES 次）。
   */
  async annotateChapter(
    chapterTitle: string,
    content: string,
  ): Promise<{ speaker: string; text: string; emotion?: string }[]> {
    const userPrompt = this.buildUserPrompt(chapterTitle, content);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const raw = await chat({
          system: SCRIPT_ANNOTATOR_PROMPT,
          user: userPrompt,
          temperature: 0.1,
          maxTokens: 8192,
        });

        if (!raw) {
          logger.warn("LLM 标注返回为空", { chapter: chapterTitle, attempt });
          if (attempt < MAX_RETRIES) continue;
          return this.fallbackContent(content);
        }

        const jsonStr = this.extractJson(raw);
        const parsed = JSON.parse(jsonStr);
        const validated = ChapterAnnotationSchema.parse(parsed);

        logger.info("章节标注完成", {
          chapter: chapterTitle,
          segments: validated.segments.length,
          attempt,
        });

        return validated.segments;
      } catch (err) {
        const reason =
          err instanceof ZodError
            ? "Zod 校验失败: " + err.errors.map((e) => e.path.join(".") + " " + e.message).join("; ")
            : err instanceof SyntaxError
              ? "JSON 解析失败"
              : String(err);

        logger.warn("章节标注失败", { chapter: chapterTitle, attempt, reason });

        if (attempt < MAX_RETRIES) continue;

        logger.warn("章节标注超过最大重试次数，回退到纯文本", {
          chapter: chapterTitle,
        });
        return this.fallbackContent(content);
      }
    }

    return this.fallbackContent(content);
  }

  /* ───────── 构建用户 prompt ───────── */
  private buildUserPrompt(chapterTitle: string, content: string): string {
    return `请标注以下章节：

【${chapterTitle}】

${content}`;
  }

  /* ───────── 从 LLM 响应中提取 JSON ───────── */
  private extractJson(text: string): string {
    // 移除可能的 markdown 代码块包装
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();

    // 尝试直接查找最外层花括号
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
      return text.slice(braceStart, braceEnd + 1);
    }

    return text.trim();
  }

  /* ───────── 回退：整章作为旁白单段 ───────── */
  private fallbackContent(content: string): { speaker: string; text: string }[] {
    // 按段落切分保持可读性，但每个段落都是旁白
    const paragraphs = content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return [{ speaker: "旁白", text: content }];
    }

    // 合并短段落（少于 50 字的跟上一个合并）
    const merged: string[] = [];
    for (const p of paragraphs) {
      if (merged.length > 0 && p.length < 50) {
        merged[merged.length - 1] += "\n\n" + p;
      } else {
        merged.push(p);
      }
    }

    return merged.map((text) => ({ speaker: "旁白", text }));
  }
}

export const scriptAnnotator = new ScriptAnnotator();

