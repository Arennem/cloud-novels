import type { TtsRequest } from '../schemas/tts.schema.js';
import { logger } from '../utils/logger.js';

export class CosyVoiceService {
  /**
   * 单段文本合成（低层级 API）
   */
  async synthesize(params: TtsRequest): Promise<Buffer> {
    logger.info('合成语音', { text: params.text.slice(0, 30), voice: params.voice });
    // TODO: 调用 DashScope API
    throw new Error('CosyVoiceService.synthesize 尚未接入 API');
  }

  /**
   * 通过 instruct 模式生成一段参考语音并注册为 speaker
   */
  async createSpeakerFromInstruct(_baseVoice: string, _promptText: string): Promise<string> {
    // TODO: 调用 DashScope instruct TTS → 注册 speaker
    throw new Error('CosyVoiceService.createSpeakerFromInstruct 尚未接入 API');
  }

  /**
   * 使用已注册的 speaker ID 合成语音
   */
  async synthesizeWithSpeaker(_text: string, _speakerId: string, _format?: string): Promise<Buffer> {
    // TODO: 使用 speaker ID 调用 DashScope API
    throw new Error('CosyVoiceService.synthesizeWithSpeaker 尚未接入 API');
  }
}

export const cosyvoiceService = new CosyVoiceService();
