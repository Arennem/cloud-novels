import { z } from 'zod';
import { AudioFormat } from './common.schema.js';
import { CharacterPortraitSchema } from './character.schema.js';

export const ChapterSchema = z.object({
  title:   z.string().min(1, '章节标题不能为空'),
  content: z.string().min(1, '章节内容不能为空'),
  voice:   z.string().optional(),
  roles:   z.record(z.string()).optional(),
});

/** 不带 title 的原始章节，用于上传解析后的返回 */
export const RawChapterSchema = z.object({
  title:   z.string().min(1, '章节标题不能为空'),
  content: z.string().min(1, '章节内容不能为空'),
});
export type RawChapter = z.infer<typeof RawChapterSchema>;

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

/** 合成时可选的角色完整画像覆盖 */
export const CharacterOverrideMapSchema = z.record(
  z.string(),
  CharacterPortraitSchema.partial(),
);
export type CharacterOverrideMap = z.infer<typeof CharacterOverrideMapSchema>;

export const ConvertRequestSchema = NovelRequestSchema.extend({
  character_overrides: CharacterOverrideMapSchema.optional(),
});
export type ConvertRequest = z.infer<typeof ConvertRequestSchema>;

// ── 上传接口 ──────────────────────────────────────

export const UploadRequestSchema = z.object({
  novel_title: z.string().min(1, '小说名称必填'),
  content:     z.string().min(1, '小说内容不能为空'),
});
export type UploadRequest = z.infer<typeof UploadRequestSchema>;

export const UploadResponseSchema = z.object({
  novel_title:   z.string(),
  chapters:      z.array(RawChapterSchema),
  chapter_count: z.number().int().positive(),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

// ── 分析接口 ──────────────────────────────────────

export const AnalyzeRequestSchema = z.object({
  novel_title:           z.string().min(1, '小说名称必填'),
  chapters:              z.array(ChapterSchema).min(1, '至少需要一章'),
  character_descriptions: z.record(z.string()).optional(),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

// ── 管理接口（ID 通过 body 而非路径参数传递） ────────

export const NovelQuerySchema = z.object({
  id: z.string().min(1, '小说 ID 不能为空'),
});
export type NovelQuery = z.infer<typeof NovelQuerySchema>;

export const CharacterQuerySchema = z.object({
  novel_id: z.string().min(1, '小说 ID 不能为空'),
});
export type CharacterQuery = z.infer<typeof CharacterQuerySchema>;

export const CharacterDeleteSchema = z.object({
  novel_id:  z.string().min(1, '小说 ID 不能为空'),
  role_name: z.string().min(1, '角色名不能为空'),
});
export type CharacterDelete = z.infer<typeof CharacterDeleteSchema>;

// ── 响应 ──────────────────────────────────────────

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

export const AnalyzeResponseSchema = z.object({
  characters:       z.array(CharacterPortraitSchema),
  character_count:  z.number().int(),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;


// ── 章节查询 ────────────────────────────────────

export const ChapterQuerySchema = z.object({
  novel_title: z.string().optional(),
  novel_id:    z.string().optional(),
}).refine((d) => d.novel_title || d.novel_id, {
  message: 'novel_title 或 novel_id 至少需要提供一个',
});
export type ChapterQuery = z.infer<typeof ChapterQuerySchema>;

// ── 音频缓存查询 ──────────────────────────────────

export const NovelAudioQuerySchema = z.object({
  novel_id:    z.string().optional(),
  novel_title: z.string().optional(),
}).refine((d) => d.novel_id || d.novel_title, {
  message: 'novel_id 或 novel_title 至少需要提供一个',
});
export type NovelAudioQuery = z.infer<typeof NovelAudioQuerySchema>;

// ── 按章节名查询音频缓存 ──────────────────────────

export const ChapterAudioQuerySchema = z.object({
  chapter_title: z.string().min(1, '章节标题不能为空'),
  novel_id:      z.string().optional(),
  novel_title:   z.string().optional(),
}).refine((d) => {
  // novel_id 和 novel_title 不能同时传，但可以都不传
  if (d.novel_id && d.novel_title) return false;
  return true;
}, {
  message: 'novel_id 和 novel_title 不能同时提供',
});
export type ChapterAudioQuery = z.infer<typeof ChapterAudioQuerySchema>;


// ── 手动合成：注册角色声音 ─────────────────────────

export const RegisterSpeakersRequestSchema = z.object({
  novel_id:    z.string().optional(),
  novel_title: z.string().optional(),
  character_descriptions: z.record(z.string()).optional(),
  character_overrides: CharacterOverrideMapSchema.optional(),
}).refine((d) => d.novel_id || d.novel_title, {
  message: 'novel_id 或 novel_title 至少需要提供一个',
});
export type RegisterSpeakersRequest = z.infer<typeof RegisterSpeakersRequestSchema>;

// ── 手动合成：按需合成章节音频 ─────────────────────

export const SynthesizeRequestSchema = z.object({
  novel_id:       z.string().optional(),
  novel_title:    z.string().optional(),
  chapter_ids:    z.array(z.string()).optional(),
  chapter_titles: z.array(z.string()).optional(),
  all:            z.boolean().default(false),
  output_format:  AudioFormat.default('mp3'),
  merge:          z.boolean().default(false),
  cache:          z.boolean().default(true),
}).refine((d) => d.novel_id || d.novel_title, {
  message: 'novel_id 或 novel_title 至少需要提供一个',
}).refine((d) => d.all || d.chapter_ids || d.chapter_titles, {
  message: '请指定要合成的章节（chapter_ids、chapter_titles）或设置 all: true',
});
export type SynthesizeRequest = z.infer<typeof SynthesizeRequestSchema>;

export const SynthesizeResultSchema = z.object({
  title:            z.string(),
  chapter_id:       z.string(),
  duration_seconds: z.number(),
  url:              z.string(),
});
export type SynthesizeResult = z.infer<typeof SynthesizeResultSchema>;

// ── 重新生成角色声音 ───────────────────────────────

export const RegenerateSpeakerRequestSchema = z.object({
  novel_id:  z.string().min(1, '小说 ID 不能为空'),
  role_name: z.string().min(1, '角色名不能为空'),
  portrait_override: CharacterPortraitSchema.partial().optional(),
});
export type RegenerateSpeakerRequest = z.infer<typeof RegenerateSpeakerRequestSchema>;
