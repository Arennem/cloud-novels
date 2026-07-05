import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { ensureDir } from './utils/file.js';
import { initDb, closeDb } from './db/index.js';
import { ttsRoutes } from './routes/tts.js';
import { novelRoutes } from './routes/novel.js';
import { voicesRoutes } from './routes/voices.js';
import { speakerManager } from './services/speaker_manager.js';
import { novelManager } from './services/novel_manager.js';

async function main() {
  ensureDir(config.OUTPUT_DIR);
  initDb();

  const app = Fastify({ logger: false });
  await app.register(cors);

  // ── 全局错误处理器 ──
  app.setErrorHandler((error: unknown, _request, reply) => {
    const err = error as Error & { statusCode?: number; validation?: unknown };

    // Zod 校验错误 → 422
    if (err instanceof ZodError) {
      return reply.status(422).send({
        error: '请求参数校验失败',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
    }

    // Fastify 内置的错误（如 404）
    if (err.statusCode) {
      return reply.status(err.statusCode).send({ error: err.message });
    }

    // 未预期的错误 → 500，不暴露详情
    logger.error('未处理的请求错误', { message: err.message, stack: err.stack });
    return reply.status(500).send({ error: '服务器内部错误' });
  });

  // ── 核心业务路由 ──
  await app.register(ttsRoutes);
  await app.register(novelRoutes);
  await app.register(voicesRoutes);

  // ── 小说管理 ──
  app.get('/novels', async () => ({ novels: novelManager.listAll() }));

  app.get('/novels/:novelId', async (request, reply) => {
    const { novelId } = request.params as { novelId: string };
    const novel = novelManager.getById(novelId);
    if (!novel) return reply.status(404).send({ error: '小说未找到' });
    return novel;
  });

  app.delete('/novels/:novelId', async (request, reply) => {
    const { novelId } = request.params as { novelId: string };
    const deleted = novelManager.delete(novelId);
    if (!deleted) return reply.status(404).send({ error: '小说未找到' });
    return { status: 'deleted', novel_id: novelId };
  });

  // ── 角色声音管理 ──
  app.get('/characters', async () => ({ characters: speakerManager.listAllSpeakers() }));

  app.get('/novels/:novelId/characters', async (request) => {
    const { novelId } = request.params as { novelId: string };
    return { characters: speakerManager.listSpeakersByNovel(novelId) };
  });

  app.delete('/novels/:novelId/characters/:roleName', async (request, reply) => {
    const { novelId, roleName } = request.params as { novelId: string; roleName: string };
    const deleted = speakerManager.deleteSpeaker(novelId, roleName);
    if (!deleted) return reply.status(404).send({ error: '角色未找到' });
    return { status: 'deleted', roleName };
  });

  // ── 健康检查 ──
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    novels_count: novelManager.listAll().length,
    speakers_count: speakerManager.listAllSpeakers().length,
  }));

  // ── 优雅关闭 ──
  const shutdown = () => {
    logger.info('正在关闭服务...');
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info('服务已启动', { port: config.PORT, host: config.HOST });
  } catch (err) {
    logger.error('启动失败', err);
    closeDb();
    process.exit(1);
  }
}

main();

