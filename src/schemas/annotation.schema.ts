import { z } from "zod";

/**
 * LLM 逐章标注后的单段脚本
 */
export const ScriptSegmentSchema = z.object({
  speaker: z.string().describe("说话角色名；旁白或无法确定时填 '旁白'"),
  text: z.string().describe("该段的完整文本，保持原文，含引号"),
  emotion: z
    .enum(["happy", "sad", "angry", "surprise", "calm", "default"])
    .optional()
    .describe("推断的情绪，仅对话片段需要。旁白不传此字段"),
});
export type ScriptSegment = z.infer<typeof ScriptSegmentSchema>;

/**
 * LLM 返回的整章标注结果
 */
export const ChapterAnnotationSchema = z.object({
  segments: z
    .array(ScriptSegmentSchema)
    .min(1, "标注结果至少包含一个片段"),
});
export type ChapterAnnotation = z.infer<typeof ChapterAnnotationSchema>;

