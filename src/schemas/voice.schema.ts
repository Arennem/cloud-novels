import { z } from 'zod';

export const VoiceInfoSchema = z.object({
  id:       z.string(),
  name:     z.string(),
  gender:   z.enum(['male', 'female']),
  style:    z.string(),
  language: z.string().default('zh-CN'),
});
export type VoiceInfo = z.infer<typeof VoiceInfoSchema>;

export const VoicesResponseSchema = z.object({
  voices: z.array(VoiceInfoSchema),
});
export type VoicesResponse = z.infer<typeof VoicesResponseSchema>;
