import { z } from 'zod';
import { AudioFormat, Emotion } from './common.schema.js';

export const TtsRequestSchema = z.object({
  text:     z.string().min(1, '文本不能为空').max(500, '单次合成不超过 500 字'),
  voice:    z.string().min(1).default('longxiaochun'),
  speed:    z.number().min(0.5).max(2.0).default(1.0),
  format:   AudioFormat.default('mp3'),
  emotion:  Emotion.optional(),
});
export type TtsRequest = z.infer<typeof TtsRequestSchema>;
