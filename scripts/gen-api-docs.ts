import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { routeSchema } from "../src/swagger-helper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "../docs");

async function main() {
  const app = Fastify({ logger: false });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Cloud Novels API",
        description: "小说文本转语音服务 — 基于 Fastify + Zod + 阿里云百炼 CosyVoice",
        version: "0.1.0",
      },
      servers: [{ url: "http://localhost:3000", description: "开发服务器" }],
      tags: [
        { name: "novel", description: "小说管理 & 合成管线" },
        { name: "tts", description: "单段 TTS 语音合成" },
        { name: "voice", description: "音色管理" },
        { name: "character", description: "角色声音管理" },
        { name: "system", description: "系统 & 健康检查" },
      ],
    },
  });

  const dummy = async () => ({ status: 0, data: null, errorMsg: null, timestamp: "", traceId: "" });


  // ── novel routes ────────
  app.post('/novel/upload', {
    schema: routeSchema({
      description: '上传小说原始文本，自动解析为章节列表',
      tags: ['novel'], summary: '上传文本',
      body: { type: 'object', required: ['novel_title', 'content'], properties: {
        novel_title: { type: 'string', description: '小说名称' },
        content: { type: 'string', description: '小说文本内容' },
      } },
      response: { '200': { description: '解析成功', data: {
        type: 'object', properties: {
          novel_title: { type: 'string' },
          chapters: { type: 'object', properties: { total: { type: 'integer' }, pageNum: { type: 'integer' }, pageSize: { type: 'integer' }, list: { type: 'array', items: { type: 'object' } } } },
        },
      } } },
    }),
  }, dummy);

  app.post('/novel/analyze', {
    schema: routeSchema({
      description: '对已有章节进行 LLM 角色分析，不含语音合成',
      tags: ['novel'], summary: '角色分析',
      body: { type: 'object', required: ['novel_title', 'chapters'], properties: {
        novel_title: { type: 'string', description: '小说名称' },
        chapters: { type: 'array', items: { type: 'object' }, description: '章节列表' },
        character_descriptions: { type: 'object', additionalProperties: { type: 'string' }, description: '可选的角色声音描述' },
      } },
      response: { '200': { description: '分析完成', data: { type: 'object', properties: { characters: { type: 'object' } } } } },
    }),
  }, dummy);

  app.post('/novel/convert', {
    schema: routeSchema({
      description: '完整合成流程：角色分析 → 注册声音 → 逐句语音合成',
      tags: ['novel'], summary: '合成语音',
      body: { type: 'object', required: ['novel_title', 'chapters'], properties: {
        novel_title: { type: 'string', description: '小说名称' },
        chapters: { type: 'array', items: { type: 'object' }, description: '章节列表' },
        output_format: { type: 'string', enum: ['wav', 'mp3', 'pcm'], default: 'mp3' },
        merge: { type: 'boolean', default: false, description: '是否合并为单个音频文件' },
        cache: { type: 'boolean', default: true, description: '是否使用音频缓存' },
        character_descriptions: { type: 'object', additionalProperties: { type: 'string' }, description: '角色声音描述' },
        character_overrides: { type: 'object', description: '角色画像覆盖' },
      } },
      response: { '200': { description: '合成任务创建成功', data: {
        type: 'object', properties: {
          task_id: { type: 'string', format: 'uuid' },
          task_status: { type: 'string', enum: ['completed', 'processing'] },
          novel_id: { type: 'string' },
          chapters: { type: 'object' },
          characters_registered: { type: 'array', items: { type: 'string' } },
          merged_url: { type: 'string' },
        },
      } } },
    }),
  }, dummy);

  app.get('/novel/audio', {
    schema: routeSchema({
      description: '查询小说的音频缓存记录',
      tags: ['novel'], summary: '音频缓存查询',
      querystring: { type: 'object', properties: {
        novel_id: { type: 'string', description: '小说 ID' },
        novel_title: { type: 'string', description: '小说名称' },
      } },
      response: { '200': { description: '查询成功', data: { type: 'object', properties: { audio: { type: 'object' } } } } },
    }),
  }, dummy);

  app.get('/novel/audio/chapter', {
    schema: routeSchema({
      description: '按章节名查询音频缓存记录',
      tags: ['novel'], summary: '章节音频查询',
      querystring: { type: 'object', required: ['chapter_title'], properties: {
        chapter_title: { type: 'string', description: '章节标题' },
        novel_id: { type: 'string', description: '小说 ID' },
        novel_title: { type: 'string', description: '小说名称' },
      } },
      response: { '200': { description: '查询成功', data: { type: 'object', properties: { audio: { type: 'object' } } } } },
    }),
  }, dummy);

  app.get('/novels', {
    schema: routeSchema({
      description: '获取所有小说列表',
      tags: ['novel'], summary: '小说列表',
      response: { '200': { description: '查询成功', data: { type: 'object', properties: { novels: { type: 'object' } } } } },
    }),
  }, dummy);

  app.get('/novel', {
    schema: routeSchema({
      description: '按 ID 查询小说详情',
      tags: ['novel'], summary: '小说详情',
      querystring: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: '小说 ID' } } },
      response: { '200': { description: '查询成功' }, '404': { description: '小说未找到' } },
    }),
  }, dummy);

  app.get('/novel/chapters', {
    schema: routeSchema({
      description: '查询小说的章节列表',
      tags: ['novel'], summary: '章节列表',
      querystring: { type: 'object', properties: {
        novel_title: { type: 'string', description: '小说名称' },
        novel_id: { type: 'string', description: '小说 ID' },
      } },
      response: { '200': { description: '查询成功', data: { type: 'object', properties: { chapters: { type: 'object' } } } }, '404': { description: '未找到小说或无章节记录' } },
    }),
  }, dummy);

  app.post('/novel/delete', {
    schema: routeSchema({
      description: '按 ID 删除小说及其相关数据',
      tags: ['novel'], summary: '删除小说',
      body: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: '小说 ID' } } },
      response: { '200': { description: '删除成功', data: { type: 'object', properties: { novel_id: { type: 'string' } } } }, '404': { description: '小说未找到' } },
    }),
  }, dummy);

  // ── character routes ────
  app.get('/characters', {
    schema: routeSchema({
      description: '列出角色列表，可按 novel_id 过滤',
      tags: ['character'], summary: '角色列表',
      querystring: { type: 'object', properties: { novel_id: { type: 'string', description: '小说 ID（可选）' } } },
      response: { '200': { description: '查询成功', data: { type: 'object', properties: { characters: { type: 'object' } } } } },
    }),
  }, dummy);

  app.post('/characters/delete', {
    schema: routeSchema({
      description: '删除指定小说的指定角色',
      tags: ['character'], summary: '删除角色',
      body: { type: 'object', required: ['novel_id', 'role_name'], properties: {
        novel_id: { type: 'string', description: '小说 ID' },
        role_name: { type: 'string', description: '角色名' },
      } },
      response: { '200': { description: '删除成功', data: { type: 'object', properties: { role_name: { type: 'string' } } } }, '404': { description: '角色未找到' } },
    }),
  }, dummy);

  // ── tts routes ──────────
  app.post('/tts', {
    schema: routeSchema({
      description: '单段文本语音合成（不经过角色分析管线）',
      tags: ['tts'], summary: '单段 TTS 合成',
      body: { type: 'object', required: ['text'], properties: {
        text: { type: 'string', maxLength: 500, description: '合成文本，最多 500 字' },
        voice: { type: 'string', default: 'longxiaochun', description: '音色 ID' },
        speed: { type: 'number', default: 1.0, minimum: 0.5, maximum: 2.0, description: '语速倍率' },
        format: { type: 'string', enum: ['wav', 'mp3', 'pcm'], default: 'mp3', description: '音频格式' },
        emotion: { type: 'string', enum: ['happy', 'sad', 'angry', 'surprise', 'calm', 'default'], description: '情感' },
      } },
      response: { '200': { description: '合成成功，返回音频二进制流' }, '502': { description: '语音合成服务调用失败' } },
    }),
  }, dummy);

  // ── voice routes ────────
  app.get('/voices', {
    schema: routeSchema({
      description: '获取所有内置音色列表',
      tags: ['voice'], summary: '音色列表',
      response: { '200': { description: '查询成功', data: {
        type: 'object', properties: {
          voices: { type: 'object', properties: { total: { type: 'integer' }, list: { type: 'array', items: { type: 'object' } }, pageNum: { type: 'integer' }, pageSize: { type: 'integer' } } },
        },
      } } },
    }),
  }, dummy);

  // ── system routes ───────
  app.get('/health', {
    schema: routeSchema({
      description: '健康检查，返回系统概览',
      tags: ['system'], summary: '健康检查',
      response: { '200': { description: '服务正常', data: { type: 'object', properties: { novels_count: { type: 'integer' }, speakers_count: { type: 'integer' } } } } },
    }),
  }, dummy);



  // ── generate ──
  await app.ready();
  const spec = app.swagger();
  const jsonPath = resolve(DOCS_DIR, 'openapi.json');
  writeFileSync(jsonPath, JSON.stringify(spec, null, 2), 'utf-8');
  console.log('✔ OpenAPI spec ->', jsonPath);
  console.log('');

  // ── HTML (Scalar) ──
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
  console.log('打开 docs/api-docs.html 即可浏览');
}

main().catch((err) => {
  console.error('生成失败:', err);
  process.exit(1);
});

