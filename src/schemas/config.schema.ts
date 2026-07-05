import { z } from 'zod';

export const ConfigSchema = z.object({
  DASHSCOPE_API_KEY: z.string().min(1, '阿里云百炼 API Key 必填'),
  PORT:              z.coerce.number().default(3000),
  HOST:              z.string().default('0.0.0.0'),
  OUTPUT_DIR:        z.string().default('./output'),
  DB_PATH:           z.string().default('./data/cloud-novels.db'),
  DEFAULT_VOICE:     z.string().default('longxiaochun'),
  MAX_TEXT_LENGTH:   z.coerce.number().default(500),
  LLM_MODEL:         z.string().default('qwen-max'),
  LOG_LEVEL:         z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export type Config = z.infer<typeof ConfigSchema>;
