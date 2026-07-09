import { z } from 'zod';

/**
 * 大模型分析后返回的角色画像 */
export const CharacterPortraitSchema = z.object({
  name: z.string().describe('角色名'),
  gender: z.enum(['male', 'female', 'unknown']).describe('性别'),
  age: z.string().describe('年龄描述，如"二十二岁"、"中年"'),
  height: z.string().describe('身高体型描述，如"178cm"、"高挑"'),
  build: z.string().describe('体态，如"健壮"、"瘦削"、"魁梧"、"娇小"'),
  personality: z.array(z.string()).describe('性格特征列表，如["沉稳","果断"]'),
  voice_description: z.string().describe('声音特征描述，用于指导语音合成，如"低沉浑厚的青年男声，语气沉稳有力"'),
  speaking_style: z.string().describe('说话风格，如"语速中等，吐字清晰，说话干脆利落"'),
  voice_prompt: z.string().optional().describe('实际发送给声音设计 API 的 prompt 文本，由 buildVoicePrompt 生成后填入, 人工微调时可编辑此字段来调整音色'),
  backstory_summary: z.string().describe('角色简介，从小说中提炼的背景信息'),
});
export type CharacterPortrait = z.infer<typeof CharacterPortraitSchema>;

/**
 * 大模型分析后返回的完整结果 */
export const CharacterAnalysisResultSchema = z.object({
  characters: z.array(CharacterPortraitSchema),
});
export type CharacterAnalysisResult = z.infer<typeof CharacterAnalysisResultSchema>;
