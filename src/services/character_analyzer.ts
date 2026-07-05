import { createHash } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { CharacterAnalysisResult, CharacterPortrait } from '../schemas/character.schema.js';
import { CharacterAnalysisResultSchema } from '../schemas/character.schema.js';

const DASHSCOPE_CHAT_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
const ROLE_REGEX = /^\[(.+?)\]\s*(.*)$/;

// ── 文本压缩：只保留对话行及紧邻上下文 ─────────────────

/**
 * 从章节内容中提取对话行及紧邻上下文。
 * 目的是大幅压缩送大模型的文本量——去掉纯景物/动作/环境描写，
 * 只保留对角色画像有用的信息。
 */
function extractDialogueWithContext(content: string): string {
  const lines = content.split('\n');
  const isDialogue = lines.map((line) => ROLE_REGEX.test(line));

  // 标记需要保留的行：对话行本身 + 前后 1 行上下文
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
      result.push(`（旁白：${line}）`);
    }
  }

  return result.join('\n');
}

function buildUserPrompt(chapters: { title: string; content: string }[]): string {
  let totalChars = 0;
  let compressedChars = 0;

  const parts = chapters.map((ch, i) => {
    const extracted = extractDialogueWithContext(ch.content);
    totalChars += ch.content.length;
    compressedChars += extracted.length;
    return `【第${i + 1}章 ${ch.title}】\n${extracted}`;
  });

  const ratio = totalChars > 0 ? ((1 - compressedChars / totalChars) * 100).toFixed(1) : '0.0';
  logger.info('角色分析文本压缩', { totalChars, compressedChars, compressionRatio: `${ratio}%` });

  return `以下是小说各章节的内容摘要（已保留对话及相关上下文，省略纯场景描写）：\n\n${parts.join('\n\n')}`;
}

// ── LLM 响应类型 ────────────────────────────────────────

interface QwenResponse {
  output?: {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
}

// ── 分析器 ──────────────────────────────────────────────

export interface CharacterAnalysisRequest {
  chapters: { title: string; content: string }[];
  existingCharacters?: string[];
}

const systemPrompt = `你是一个专业的小说角色分析专家。你的任务是分析小说文本，提取每个角色的详细特征。

分析要求：
1. 仔细阅读所有章节，找出所有有台词的角色（包括旁白）
2. [角色名] 标记代表该角色的台词，上下文的描述和动作也提供角色特征
3. 根据角色的台词内容、其他角色对他的描述、作者旁白等，综合分析角色特征

请严格按照以下 JSON 格式返回：

{
  "characters": [
    {
      "name": "角色名",
      "gender": "male" | "female" | "unknown",
      "age": "年龄描述",
      "height": "身高体型描述",
      "build": "体态描述",
      "personality": ["性格标签1", "性格标签2"],
      "voice_description": "声音特征描述（30字左右，详细描述音色、音调、质感，用于语音合成）",
      "speaking_style": "说话风格描述",
      "backstory_summary": "角色简介"
    }
  ]
}

注意：
- voice_description 要具体到音色质感，如"低沉浑厚的青年男声，略带磁性，语气沉稳有力"
- 只返回 JSON，不要其他文字
- 如果小说中没有明确提到某个特征，根据台词和上下文合理推断`;

export class CharacterAnalyzer {
  async analyze(params: CharacterAnalysisRequest): Promise<CharacterAnalysisResult> {
    const apiKey = config.DASHSCOPE_API_KEY;
    if (!apiKey) {
      logger.warn('未配置 DASHSCOPE_API_KEY，跳过角色智能分析');
      return { characters: [] };
    }

    logger.info('开始大模型角色分析', {
      chapters: params.chapters.length,
      existingCharacters: params.existingCharacters?.length ?? 0,
    });

    try {
      const response = await fetch(DASHSCOPE_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.LLM_MODEL,
          input: {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: buildUserPrompt(params.chapters) },
            ],
          },
          parameters: {
            result_format: 'message',
            temperature: 0.3,
            max_tokens: 4096,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error('大模型 API 调用失败', { status: response.status, error: errText });
        return { characters: [] };
      }

      const data = (await response.json()) as QwenResponse;
      const content = data.output?.choices?.[0]?.message?.content;

      if (!content) {
        logger.warn('大模型返回为空');
        return { characters: [] };
      }

      const jsonStr = this.extractJson(content);
      const result = CharacterAnalysisResultSchema.parse(JSON.parse(jsonStr));

      logger.info('角色分析完成', { count: result.characters.length });

      if (params.existingCharacters && params.existingCharacters.length > 0) {
        const existing = new Set(params.existingCharacters);
        result.characters = result.characters.filter((c) => !existing.has(c.name));
      }

      return result;
    } catch (err) {
      logger.error('角色分析异常', { error: String(err) });
      return { characters: [] };
    }
  }

  private extractJson(text: string): string {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();

    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1) {
      return text.slice(braceStart, braceEnd + 1);
    }

    return text.trim();
  }

  buildVoicePrompt(portrait: CharacterPortrait): string {
    const voiceParts: string[] = [];

    const genderMap: Record<string, string> = {
      male: '男声',
      female: '女声',
      unknown: '声音',
    };
    voiceParts.push(genderMap[portrait.gender] ?? '声音');

    if (portrait.voice_description) {
      voiceParts.push(portrait.voice_description);
    }

    if (portrait.speaking_style) {
      voiceParts.push(`说话时${portrait.speaking_style}`);
    }

    return voiceParts.join('，');
  }
}

export const characterAnalyzer = new CharacterAnalyzer();
