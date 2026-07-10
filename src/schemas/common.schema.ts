import { z } from 'zod';

// ── 基础类型 ──
export const VoiceId = z.string().min(1, '语音 ID 不能为空');
export type VoiceId = z.infer<typeof VoiceId>;

export const PositiveInt = z.number().int().positive();
export type PositiveInt = z.infer<typeof PositiveInt>;

export const AudioFormat = z.enum(['wav', 'mp3', 'pcm']);
export type AudioFormat = z.infer<typeof AudioFormat>;

export const Emotion = z.enum(['happy', 'sad', 'angry', 'surprise', 'calm', 'default']);
export type Emotion = z.infer<typeof Emotion>;

// ── 分页查询参数 ──
export const PaginationSchema = z.object({
  pageNum: z.coerce.number().int().min(1).default(1).describe('页码，从 1 开始'),
  pageSize: z.coerce.number().int().min(1).max(50).default(10).describe('每页条数，最大 50'),
});
export type PaginationQuery = z.infer<typeof PaginationSchema>;
