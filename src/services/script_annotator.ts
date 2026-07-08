import { logger } from "../utils/logger.js";
import { chat } from "./llm.js";
import { ChapterAnnotationSchema } from "../schemas/annotation.schema.js";
import { ZodError } from "zod";

/* ───────── 系统提示 ───────── */

const SYSTEM_PROMPT = `你是一个小说脚本标注专家。你的任务是将小说章节文本解析为结构化的脚本格式，标注每一段的说话角色和情绪。

# 核心规则

1. **分段原则**：以自然段落或对话轮次为单位切分。同一角色连续的几句话合并为一个片段。叙述性文字按段落切分。

2. **说话人识别**：
   - 对话内容前面有「某某说」「某某道」「某某问」等提示词的，说话人取提示词中的人物名
   - 直接引语（引号内对话）根据上下文推断说话人
   - 无法确定说话人的对话标为 "旁白"
   - 纯叙述、描写、心理活动标为 "旁白"

3. **情绪推断**（仅对话片段需要，旁白不传 emotion）：
   - happy：开心、兴奋、愉快
   - sad：悲伤、失落、哀伤
   - angry：愤怒、生气、恼怒
   - surprise：惊讶、意外
   - calm：平静、淡然、从容
   - default：中性语气，无明显情绪
   - 从对话内容和上下文描写中推断

4. **文本保留**：保持原文完整，包括引号、标点符号、语气词。

# 输出格式

返回一个 JSON 对象，格式如下：

{
  "segments": [
    {
      "speaker": "旁白",
      "text": "叙述段落原文..."
    },
    {
      "speaker": "角色名",
      "text": "\"对话原文\"",
      "emotion": "推断的情绪"
    }
  ]
}

注意：
- 只返回 JSON，不要包含 \`\`\`json 标记或其他文字
- segments 数组不能为空
- 必须严格按照上述 JSON Schema 输出
- emotion 字段只能取以下值：happy, sad, angry, surprise, calm, neutral
`;

/* ───────── 最大重试次数 ───────── */
const MAX_RETRIES = 2;

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
          system: SYSTEM_PROMPT,
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

