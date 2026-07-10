import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { chat } from "./llm.js";
import type { CharacterAnalysisResult, CharacterPortrait } from "../schemas/character.schema.js";
import { CharacterAnalysisResultSchema } from "../schemas/character.schema.js";
import { CHARACTER_ANALYZER_PROMPT, ROLE_REGEX } from '../constants/index.js';


// ── 文本压缩：只保留对话行及紧邻上下文 ────────────────

function extractDialogueWithContext(content: string): string {
  const lines = content.split("\n");
  const isDialogue = lines.map((line) => ROLE_REGEX.test(line));
  const keep = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (isDialogue[i]) {
      keep[i] = true;
      if (i > 0) keep[i - 1] = true;
      if (i < lines.length - 1) keep[i + 1] = true;
    }
  }
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) continue;
    const line = lines[i].trim();
    if (!line) continue;
    const match = line.match(ROLE_REGEX);
    if (match) {
      result.push(line);
    } else {
      result.push('（旁白：' + line + '）');
    }
  }
  return result.join("\n");
}

interface ChapterBlock { title: string; content: string }
function buildUserPrompt(chapters: ChapterBlock[]): string {
  let totalChars = 0; let compressedChars = 0;
  const parts = chapters.map((ch, i) => {
    const extracted = extractDialogueWithContext(ch.content);
    totalChars += ch.content.length;
    compressedChars += extracted.length;
    return '【第' + (i + 1) + '章 ' + ch.title + '】\n' + extracted;
  });
  const ratio = totalChars > 0 ? ((1 - compressedChars / totalChars) * 100).toFixed(1) : "0.0";
  logger.info("角色分析文本压缩", { totalChars, compressedChars, compressionRatio: ratio + "%" });
  return '以下是小说各章节的内容摘要（已保留对话及相关上下文，省略纯场景描写）：\n\n' + parts.join("\n\n");
}

export interface CharacterAnalysisRequest {
  chapters: { title: string; content: string }[];
  existingCharacters?: string[];
}


export class CharacterAnalyzer {
  async analyze(params: CharacterAnalysisRequest): Promise<CharacterAnalysisResult> {
    logger.info("开始大模型角色分析", {
      chapters: params.chapters.length,
      existingCharacters: params.existingCharacters?.length ?? 0,
    });
    try {
      const content = await chat({
        system: CHARACTER_ANALYZER_PROMPT,
        user: buildUserPrompt(params.chapters),
        temperature: 0.3,
        maxTokens: 4096,
      });
      if (!content) {
        logger.warn("大模型返回为空");
        return { characters: [] };
      }
      const jsonStr = this.extractJson(content);
      const result = CharacterAnalysisResultSchema.parse(JSON.parse(jsonStr));
      logger.info("角色分析完成", { count: result.characters.length });
      if (params.existingCharacters && params.existingCharacters.length > 0) {
        const existing = new Set(params.existingCharacters);
        result.characters = result.characters.filter((c) => !existing.has(c.name));
      }
      return result;
    } catch (err) {
      logger.error("角色分析异常", { error: String(err) });
      return { characters: [] };
    }
  }

  private extractJson(text: string): string {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd !== -1) {
      return text.slice(braceStart, braceEnd + 1);
    }
    return text.trim();
  }

  /**
   * 从角色画像构建发送给声音设计 API 的 prompt 文本，
   * 并将结果写回 portrait.voice_prompt 以便落库和人工微调。
   */
  buildVoicePrompt(portrait: CharacterPortrait): string {
    const voiceParts: string[] = [];
    const genderMap: Record<string, string> = { male: "男声", female: "女声", unknown: "声音" };
    voiceParts.push(genderMap[portrait.gender] ?? "声音");
    if (portrait.voice_description) {
      voiceParts.push(portrait.voice_description);
    }
    if (portrait.speaking_style) {
      voiceParts.push('说话时' + portrait.speaking_style);
    }
    const prompt = voiceParts.join("，");
    // 写回 portrait，确保精确的 prompt 文本落库
    portrait.voice_prompt = prompt;
    return prompt;
  }

  /** 将角色画像映射为合成时的 emotion / speed 参数 */
  deriveSynthesisParams(portrait: CharacterPortrait): {
    emotion?: string;
    speed?: number;
  } {
    const result: { emotion?: string; speed?: number } = {};

    // ── personality → emotion ──
    const emotionMap: [string[], string][] = [
      [["暴躁", "易怒", "愤怒", "恼怒", "凶狠", "严厉", "冷酷", "威严"], "angry"],
      [["活泼", "开朗", "欢乐", "乐观", "欢快", "俏皮", "调皮", "爽朗"], "happy"],
      [["悲伤", "忧郁", "哀伤", "伤感", "多愁善感", "消沉", "凄凉", "悲凉"], "sad"],
      [["惊讶", "惊奇", "神秘", "诡异", "捉摸不透"], "surprise"],
      [["温柔", "温和", "宁静", "平和", "淡然", "冷静", "沉着", "沉稳", "慈祥"], "calm"],
    ];

    if (portrait.personality && portrait.personality.length > 0) {
      for (const trait of portrait.personality) {
        for (const [keywords, emotion] of emotionMap) {
          if (keywords.some((kw) => trait.includes(kw))) {
            result.emotion = emotion;
            break;
          }
        }
        if (result.emotion) break;
      }
    }

    // ── speaking_style → speed ──
    if (portrait.speaking_style) {
      const style = portrait.speaking_style;
      if (
        style.includes("缓慢") ||
        style.includes("慢") ||
        style.includes("从容") ||
        style.includes("沉稳") ||
        style.includes("拖沓")
      ) {
        result.speed = 0.85;
      } else if (
        style.includes("快速") ||
        style.includes("快") ||
        style.includes("急促") ||
        style.includes("急躁") ||
        style.includes("活泼")
      ) {
        result.speed = 1.15;
      }
    }

    return result;
  }
}

export const characterAnalyzer = new CharacterAnalyzer();
