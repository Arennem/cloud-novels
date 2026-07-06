import type { TtsRequest } from '../schemas/tts.schema.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const DASHSCOPE_COSYVOICE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/tts/cosyvoice';

interface CosyVoiceResponse {
  output?: {
    speaker_id?: string;
  };
}

export class CosyVoiceService {
  async synthesize(params: TtsRequest): Promise<Buffer> {
    const apiKey = config.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 未配置');
    }

    logger.info('合成语音', { text: params.text.slice(0, 30), voice: params.voice });

    const body: Record<string, unknown> = {
      model: config.COSYVOICE_MODEL,
      input: {
        text: params.text,
        voice: params.voice,
      },
      parameters: {
        format: params.format,
        sample_rate: 24000,
        speed: params.speed,
      },
    };

    if (params.emotion) {
      (body.parameters as Record<string, unknown>).emotion = params.emotion;
    }

    const response = await fetch(DASHSCOPE_COSYVOICE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('CosyVoice API 调用失败', { status: response.status, error: errText });
      throw new Error(`CosyVoice API 返回 ${response.status}: ${errText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    logger.info('合成成功', { size: buffer.length, format: params.format });
    return buffer;
  }

  async createSpeakerFromInstruct(baseVoice: string, promptText: string): Promise<string> {
    const apiKey = config.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 未配置');
    }

    logger.info('创建自定义 speaker', { baseVoice, prompt: promptText.slice(0, 40) });

    const body = {
      model: config.COSYVOICE_MODEL,
      input: {
        text: promptText,
        voice: baseVoice,
        instruct_text: promptText,
      },
      parameters: {
        format: 'mp3',
        sample_rate: 24000,
      },
    };

    const response = await fetch(DASHSCOPE_COSYVOICE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Instruct speaker 创建失败', { status: response.status, error: errText });
      logger.warn('回退到基础音色', { baseVoice });
      return baseVoice;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as CosyVoiceResponse;
      if (data.output?.speaker_id) {
        logger.info('Instruct speaker 创建成功', { speakerId: data.output.speaker_id });
        return data.output.speaker_id;
      }
    }

    logger.warn('API 未返回 speaker_id，使用 baseVoice 替代');
    return baseVoice;
  }

  async synthesizeWithSpeaker(text: string, speakerId: string, format: string = 'mp3'): Promise<Buffer> {
    const apiKey = config.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 未配置');
    }

    logger.info('使用 speaker 合成语音', { text: text.slice(0, 30), speakerId });

    const body = {
      model: config.COSYVOICE_MODEL,
      input: {
        text,
        voice: speakerId,
      },
      parameters: {
        format,
        sample_rate: 24000,
      },
    };

    const response = await fetch(DASHSCOPE_COSYVOICE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Speaker 合成失败', { status: response.status, error: errText });
      throw new Error(`Speaker 合成失败 ${response.status}: ${errText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

export const cosyvoiceService = new CosyVoiceService();
