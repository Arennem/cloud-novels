/**
 * ── 单段 TTS 合成 ──
 * POST /tts → 直接对一段文本做语音合成（不经过角色分析管线），供手动测试或独立调用。
 */
import type { FastifyInstance } from "fastify";
import { ttsSchema } from "../route-schemas/tts.schema.js";
import { TtsRequestSchema } from "../schemas/tts.schema.js";
import { cosyvoiceService } from "../services/cosyvoice.js";
import { fail } from "../utils/response.js";
import { logger } from "../utils/logger.js";

export async function ttsRoutes(app: FastifyInstance) {
  app.post("/tts", { schema: ttsSchema }, async (request, reply) => {
    const params = TtsRequestSchema.parse(request.body);

    try {
      const audio = await cosyvoiceService.synthesize(params);
      const mime = params.format === "mp3" ? "audio/mpeg" : params.format === "wav" ? "audio/wav" : "audio/l16";
      return reply.type(mime).send(audio);
    } catch (err) {
      logger.error("TTS 合成失败", { text: params.text.slice(0, 30), error: String(err) });
      return reply.status(502).send(fail("语音合成服务调用失败", 502));
    }
  });
}
