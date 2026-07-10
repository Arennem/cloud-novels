import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { healthCheckSchema } from '../src/route-schemas/health.schema.js';
import {
  notificationListSchema,
  notificationReadSchema,
  notificationReadAllSchema,
} from '../src/route-schemas/notifications.schema.js';
import {
  uploadNovelSchema,
  novelListSchema,
  novelDetailSchema,
  chapterListSchema,
  deleteNovelSchema,
  chapterDetailSchema,
} from '../src/route-schemas/novel.schema.js';
import {
  analyzeCharactersSchema,
  uploadAndAnalyzeSchema,
} from '../src/route-schemas/novel-analyze.schema.js';
import {
  novelAudioSchema,
  chapterAudioSchema,
} from '../src/route-schemas/novel-audio.schema.js';
import {
  convertNovelSchema,
  synthesizeNovelSchema,
  taskDetailSchema,
  taskListSchema,
} from '../src/route-schemas/novel-convert.schema.js';
import {
  characterListSchema,
  characterDeleteSchema as charDeleteRouteSchema,
  characterDetailSchema,
  characterUpdateSchema,
  registerSpeakersSchema,
  regenerateSpeakerSchema,
} from '../src/route-schemas/novel-speaker.schema.js';
import { ttsSchema } from '../src/route-schemas/tts.schema.js';
import { voicesListSchema } from '../src/route-schemas/voices.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, '../docs');

async function main() {
  const app = Fastify({ logger: false });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Cloud Novels API',
        description: '小说文本转语音服务 — 基于 Fastify + Zod + 阿里云百炼 CosyVoice',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3000', description: '开发服务器' }],
      tags: [
        { name: 'novel', description: '小说管理 & 合成管线' },
        { name: 'tts', description: '单段 TTS 语音合成' },
        { name: 'voice', description: '音色管理' },
        { name: 'character', description: '角色声音管理' },
        { name: 'system', description: '系统 & 健康检查' },
      ],
    },
  });

  const dummy = async () => ({ status: 0, data: null, errorMsg: null, timestamp: '', traceId: '' });

  // ── novel routes ────────
  app.post('/novel/upload',       { schema: uploadNovelSchema },       dummy);
  app.get('/novels',              { schema: novelListSchema },         dummy);
  app.get('/novel',               { schema: novelDetailSchema },       dummy);
  app.get('/novel/chapters',      { schema: chapterListSchema },       dummy);
  app.get('/novel/chapter/detail',{ schema: chapterDetailSchema },     dummy);
  app.post('/novel/delete',       { schema: deleteNovelSchema },       dummy);

  app.post('/novel/analyze',          { schema: analyzeCharactersSchema },   dummy);
  app.post('/novel/upload-and-analyze',{ schema: uploadAndAnalyzeSchema },   dummy);

  app.post('/novel/convert',      { schema: convertNovelSchema },      dummy);
  app.post('/novel/synthesize',   { schema: synthesizeNovelSchema },   dummy);
  app.get('/task/:id',            { schema: taskDetailSchema },        dummy);
  app.get('/tasks',               { schema: taskListSchema },          dummy);

  app.get('/novel/audio',         { schema: novelAudioSchema },        dummy);
  app.get('/novel/audio/chapter', { schema: chapterAudioSchema },      dummy);

  // ── character routes ────
  app.get('/characters',               { schema: characterListSchema },       dummy);
  app.post('/characters/delete',        { schema: charDeleteRouteSchema },    dummy);
  app.get('/characters/detail',         { schema: characterDetailSchema },    dummy);
  app.post('/characters/update',        { schema: characterUpdateSchema },    dummy);
  app.post('/novel/speakers/register',  { schema: registerSpeakersSchema },   dummy);
  app.post('/novel/speakers/regenerate',{ schema: regenerateSpeakerSchema },  dummy);

  // ── tts routes ──────────
  app.post('/tts', { schema: ttsSchema }, dummy);

  // ── voice routes ────────
  app.get('/voices', { schema: voicesListSchema }, dummy);

  // ── system routes ───────
  app.get('/health', { schema: healthCheckSchema }, dummy);

  // ── notification routes ─
  app.get('/notifications',           { schema: notificationListSchema },    dummy);
  app.post('/notifications/read',     { schema: notificationReadSchema },    dummy);
  app.post('/notifications/read-all', { schema: notificationReadAllSchema }, dummy);

  // ── generate ──
  await app.ready();
  const spec = app.swagger();
  const jsonPath = resolve(DOCS_DIR, 'openapi.json');
  writeFileSync(jsonPath, JSON.stringify(spec, null, 2), 'utf-8');
  console.log('✔ OpenAPI spec ->', jsonPath);

  const html = '<!DOCTYPE html>' +
'<html lang=\"zh-CN\">' +
'<head>' +
'<meta charset=\"UTF-8\">' +
'<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">' +
'<title>Cloud Novels API 文档</title>' +
'<link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/style.css\" />' +
'</head>' +
'<body>' +
'<script id=\"api-reference\" type=\"application/json\">' + JSON.stringify(spec) + '</script>' +
'<script src=\"https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/bundle.js\"></script>' +
'</body>' +
'</html>';

  const htmlPath = resolve(DOCS_DIR, 'api-docs.html');
  writeFileSync(htmlPath, html, 'utf-8');
  console.log('✔ HTML docs     ->', htmlPath);
}

main().catch((err) => {
  console.error('生成失败:', err);
  process.exit(1);
});
