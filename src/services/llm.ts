import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const DASHSCOPE_BASE_URL = 'https://ws-3fa17bric37i3kmu.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = config.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 未配置');
    }
    client = new OpenAI({
      apiKey,
      baseURL: DASHSCOPE_BASE_URL,
    });
    logger.info('LLM client 初始化', { baseURL: DASHSCOPE_BASE_URL });
  }
  return client;
}

export interface ChatParams {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * 调用阿里云百炼（Dashscope）LLM，使用 OpenAI 兼容模式。
 */
export async function chat(params: ChatParams): Promise<string | null> {
  const c = getClient();

  const response = await c.chat.completions.create({
    model: params.model ?? config.LLM_MODEL,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    temperature: params.temperature ?? 0.3,
    max_tokens: params.maxTokens ?? 4096,
  });

  const content = response.choices?.[0]?.message?.content;

  if (!content) {
    logger.warn('LLM 返回内容为空', { finishReason: response.choices?.[0]?.finish_reason });
  }

  return content ?? null;
}
