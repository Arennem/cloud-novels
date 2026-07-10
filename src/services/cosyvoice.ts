import { DASHSCOPE_COSYVOICE_URL, VOICE_DESIGN_URL, WS_URL, SAMPLE_RATE, WS_TIMEOUT_MS, MAX_VOICE_PROMPT_LENGTH } from '../constants/index.js';
import type { TtsRequest } from '../schemas/tts.schema.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import WebSocket from 'ws';


interface CosyVoiceResponse {
  output?: {
    speaker_id?: string;
    voice_id?: string;
  };
}

/**
 * CosyVoice 实时语音合成 WebSocket API 的响应帧
 */
interface WsFrame {
  header?: {
    action: string;
    task_id: string;
  };
  payload?: Record<string, unknown>;
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

  /**
   * 声音设计（Voice Design）：通过文字描述创建持久化的自定义音色。
   * 使用 CosyVoice 声音设计专用端点 /api/v1/services/audio/tts/customization，
   * 返回稳定的 voice_id，可永久用于语音合成。
   *
   * 文档：https://help.aliyun.com/zh/model-studio/voice-design-user-guide
   */
  async designVoice(voicePrompt: string, prefix: string, previewText: string): Promise<string> {
    const apiKey = config.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 未配置');
    }

    if (voicePrompt.length > MAX_VOICE_PROMPT_LENGTH) {
      logger.warn('voice_prompt 超过 ' + MAX_VOICE_PROMPT_LENGTH + ' 字符，将被截断', { length: voicePrompt.length });
      voicePrompt = voicePrompt.slice(0, MAX_VOICE_PROMPT_LENGTH);
    }

    logger.info('声音设计：开始创建自定义音色', { prefix, prompt: voicePrompt.slice(0, 60) });

    const body = {
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: config.COSYVOICE_MODEL,
        voice_prompt: voicePrompt,
        preview_text: previewText,
        prefix: prefix,
        language_hints: ['zh'],
      },
      parameters: {
        sample_rate: 24000,
        response_format: 'wav',
      },
    };

    const response = await fetch(VOICE_DESIGN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('声音设计 API 调用失败', { status: response.status, error: errText, prefix });
      return '';
    }

    const data = (await response.json()) as CosyVoiceResponse;
    const voiceId = data.output?.voice_id;

    if (voiceId) {
      logger.info('声音设计：自定义音色创建成功', { prefix, voiceId });
      return voiceId;
    }

    logger.warn('声音设计：API 未返回 voice_id', { prefix });
    return '';
  }

  /**
   * 通过 WebSocket 实时合成语音（使用声音设计返回的 voice_id）。
   * 对应 Python SDK 的 SpeechSynthesizer.call(text) 模式。
   *
   * 协议流程：
   * 1. 连接 wss://dashscope.aliyuncs.com/api-ws/v1/inference（携带 Authorization 头）
   * 2. 发送 run-task JSON 帧：配置 model/text/voice/parameters
   * 3. 接收二进制 audio 帧 + 完成事件
   * 4. 发送 finish-task
   * 5. 关闭连接
   */
  async synthesizeWithSpeaker(
    text: string, speakerId: string, format: string = "mp3",
    params?: { emotion?: string; speed?: number },
  ): Promise<Buffer> {
    const apiKey = config.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 未配置');
    }

    logger.info('WebSocket 合成语音', {
      text: text.slice(0, 30),
      speakerId,
      textLength: text.length,
    });

    const taskId = crypto.randomUUID();
    const chunks: Buffer[] = [];
    let taskFinished = false;

    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!taskFinished) {
          ws.close();
          reject(new Error('WebSocket 合成超时'));
        }
      }, 60000);

      const ws = new WebSocket(WS_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      ws.on('open', () => {
        logger.debug('WebSocket 连接已建立', { taskId });

        const payload: Record<string, unknown> = {
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

        if (params?.emotion) {
          (payload.parameters as Record<string, unknown>).emotion = params.emotion;
        }
        if (params?.speed !== undefined) {
          (payload.parameters as Record<string, unknown>).speed = params.speed;
        }

        const runTask: WsFrame = {
          header: {
            action: 'run-task',
            task_id: taskId,
          },
          payload,
        };

        ws.send(JSON.stringify(runTask));
        logger.debug('已发送 run-task', { taskId });
      });

      ws.on('message', (data: WebSocket.Data, isBinary: boolean) => {
        if (isBinary) {
          // 二进制音频数据
          chunks.push(data as Buffer);
        } else {
          // JSON 事件帧
          try {
            const frame: WsFrame = JSON.parse(data.toString());
            const action = frame.header?.action;
            logger.debug('收到事件', { action, taskId });

            if (action === 'task-finished' || action === 'finished') {
              taskFinished = true;
              // 发送 finish-task
              ws.send(JSON.stringify({
                header: { action: 'finish-task', task_id: taskId },
              }));
              // 等 on('close') 处理完成后 resolve
            } else if (action === 'error' || action === 'task-error' || action === 'TaskFailed') {
              clearTimeout(timeout);
              const errMsg = typeof frame.payload?.message === 'string'
                ? frame.payload.message
                : JSON.stringify(frame.payload);
              ws.close();
              reject(new Error(`合成任务失败: ${errMsg}`));
            }
          } catch {
            // 非 JSON 文本忽略
          }
        }
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        logger.error('WebSocket 连接错误', { taskId, error: err.message });
        reject(new Error(`WebSocket 连接错误: ${err.message}`));
      });

      ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timeout);

        const reasonStr = reason ? reason.toString() : '';

        if (taskFinished && chunks.length > 0) {
          const result = Buffer.concat(chunks);
          logger.info('WebSocket 合成成功', {
            taskId,
            size: result.length,
            chunks: chunks.length,
          });
          resolve(result);
        } else if (!taskFinished && chunks.length > 0) {
          // 某些实现以 close 作为完成信号
          logger.info('WebSocket 合成完成（close 信号）', {
            taskId,
            size: chunks.reduce((s, c) => s + c.length, 0),
            chunks: chunks.length,
          });
          resolve(Buffer.concat(chunks));
        } else if (code !== 1000 && code !== 1005) {
          reject(new Error(`WebSocket 异常关闭: code=${code}, reason=${reasonStr}`));
        } else if (chunks.length === 0) {
          reject(new Error('WebSocket 未收到音频数据'));
        }
      });
    });
  }
}

export const cosyvoiceService = new CosyVoiceService();
