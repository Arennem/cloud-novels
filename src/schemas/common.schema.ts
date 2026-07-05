import { z } from 'zod';

// ── 基础类型 ──
export const VoiceId = z.string().min(1, '音色 ID 不能为空');
export type VoiceId = z.infer<typeof VoiceId>;

export const PositiveInt = z.number().int().positive();
export type PositiveInt = z.infer<typeof PositiveInt>;

export const AudioFormat = z.enum(['wav', 'mp3', 'pcm']);
export type AudioFormat = z.infer<typeof AudioFormat>;

export const Emotion = z.enum(['happy', 'sad', 'angry', 'surprise', 'calm', 'default']);
export type Emotion = z.infer<typeof Emotion>;
