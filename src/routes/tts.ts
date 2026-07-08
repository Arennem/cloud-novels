import type { FastifyInstance } from 'fastify';
import { routeSchema } from '../swagger-helper.js';
import { TtsRequestSchema } from '../schemas/tts.schema.js';
import { cosyvoiceService } from '../services/cosyvoice.js';
import { fail } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export async function ttsRoutes(app: FastifyInstance) {
  app.post('/tts', {
    schema: routeSchema({
      description: '单段文本语音合成（不经过角色分析管线）',
      tags: ['tts'],
      summary: '单段 TTS 合成',
      body: {
        type: 'object', required: ['text'], properties: {
          text: { type: 'string', maxLength: 500, description: '合成文本，最多 500 字' },
          voice: { type: 'string', default: 'longxiaochun', description: '音色 ID' },
          speed: { type: 'number', default: 1.0, minimum: 0.5, maximum: 2.0, description: '语速倍率' },
          format: { type: 'string', enum: ['wav', 'mp3', 'pcm'], default: 'mp3', description: '音频格式' },
          emotion: { type: 'string', enum: ['happy', 'sad', 'angry', 'surprise', 'calm', 'default'], description: '情感' },
        },
      },
      response: {
        '200': { description: '合成成功，返回音频二进制流' },
        '502': { description: '语音合成服务调用失败' },
      },
    }),
  }, async (request, reply) => {
    const params = TtsRequestSchema.parse(request.body);

    try {
      const audio = await cosyvoiceService.synthesize(params);
      const mime = params.format === 'mp3' ? 'audio/mpeg' : params.format === 'wav' ? 'audio/wav' : 'audio/l16';
      return reply.type(mime).send(audio);
    } catch (err) {
      logger.error('TTS 合成失败', { text: params.text.slice(0, 30), error: String(err) });
      return reply.status(502).send(fail('语音合成服务调用失败', 502));
    }
  });
}

