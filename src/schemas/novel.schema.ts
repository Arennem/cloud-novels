import { z } from 'zod';
import { AudioFormat } from './common.schema.js';

export const ChapterSchema = z.object({
  title:   z.string().min(1, '章节标题不能为空'),
  content: z.string().min(1, '章节内容不能为空'),
  voice:   z.string().optional(),
  roles:   z.record(z.string()).optional(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const NovelRequestSchema = z.object({
  novel_title:     z.string().min(1, '小说名称必填'),
  chapters:        z.array(ChapterSchema).min(1, '至少需要一章'),
  output_format:   AudioFormat.default('mp3'),
  merge:           z.boolean().default(false),
  cache:           z.boolean().default(true),
  character_descriptions: z.record(z.string()).optional(),
});
export type NovelRequest = z.infer<typeof NovelRequestSchema>;

export const ChapterResultSchema = z.object({
  title:            z.string(),
  duration_seconds: z.number(),
  url:              z.string(),
});
export type ChapterResult = z.infer<typeof ChapterResultSchema>;

const CharacterAnalysisBriefSchema = z.object({
  name:  z.string(),
  gender: z.enum(['male', 'female', 'unknown']),
  voice_description: z.string(),
});

export const NovelResponseSchema = z.object({
  task_id:  z.string().uuid(),
  status:   z.enum(['pending', 'processing', 'completed', 'failed']),
  novel_id: z.string(),
  chapters: z.array(ChapterResultSchema),
  characters_registered: z.array(z.string()),
  character_analysis: z.array(CharacterAnalysisBriefSchema).optional(),
});
export type NovelResponse = z.infer<typeof NovelResponseSchema>;
