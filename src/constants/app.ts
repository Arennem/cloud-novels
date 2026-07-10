export const APP_TITLE = 'Cloud Novels API';
export const APP_DESCRIPTION = '小说文本转语音服务 — 基于 Fastify + Zod + 阿里云百炼 CosyVoice';
export const APP_VERSION = '0.1.0';
export const APP_SERVER_URL = 'http://localhost:3000';
export const APP_SERVER_DESCRIPTION = '开发服务器';

export const SWAGGER_TAGS = [
  { name: 'novel', description: '小说管理 & 合成管线' },
  { name: 'tts', description: '单段 TTS 语音合成' },
  { name: 'voice', description: '音色管理' },
  { name: 'character', description: '角色声音管理' },
  { name: 'system', description: '系统 & 健康检查' },
];
