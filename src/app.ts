import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { resolve } from "path";
import { ZodError } from "zod";
import { success, fail } from "./utils/response.js";
import swagger from "@fastify/swagger";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { ensureDir } from "./utils/file.js";
import { initDb, closeDb } from "./db/index.js";
import { ttsRoutes } from "./routes/tts.js";
import { voicesRoutes } from "./routes/voices.js";
import { novelRoutes } from "./routes/novel.js";
import { novelAnalyzeRoutes } from "./routes/novel-analyze.js";
import { novelConvertRoutes } from "./routes/novel-convert.js";
import { novelSpeakerRoutes } from "./routes/novel-speaker.js";
import { novelAudioRoutes } from "./routes/novel-audio.js";
import { healthRoutes } from "./routes/health.js";
import { notificationRoutes } from "./routes/notifications.js";
import { APP_TITLE, APP_DESCRIPTION, APP_VERSION, APP_SERVER_URL, APP_SERVER_DESCRIPTION, SWAGGER_TAGS, UPLOAD_FILE_SIZE_LIMIT } from './constants/index.js';

async function main() {
  ensureDir(config.OUTPUT_DIR);
  initDb();

  const app = Fastify({ logger: false });
  await app.register(cors);
  await app.register(multipart, {
    limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT },
    attachFieldsToBody: true,
  });
  await app.register(fastifyStatic, {
    root: resolve("./public"),
    prefix: "/",
    decorateReply: false,
  });

  // 角色示例音频静态目录（和章节音频分开放）
  await app.register(fastifyStatic, {
    root: resolve(config.OUTPUT_DIR, 'speaker-samples'),
    prefix: "/speaker-samples/",
    decorateReply: false,
  });

  // ── API 文档 ──
  await app.register(swagger, {
    openapi: {
      info: {
        title: APP_TITLE,
        description: APP_DESCRIPTION,
        version: APP_VERSION,
      },
      servers: [{ url: APP_SERVER_URL, description: APP_SERVER_DESCRIPTION }],
      tags: [
        SWAGGER_TAGS[0],
        SWAGGER_TAGS[1],
        SWAGGER_TAGS[2],
        SWAGGER_TAGS[3],
        SWAGGER_TAGS[4],
      ],
    },
  });

  // ── 全局错误处理器 ──
  app.setErrorHandler((error: unknown, _request, reply) => {
    const err = error as Error & { statusCode?: number };

    if (err instanceof ZodError) {
      const resp = fail("请求参数校验失败", 422);
      return reply.status(422).send({
        ...resp,
        details: err.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
    }

    if (err.statusCode) {
      return reply.status(err.statusCode).send(fail(err.message, err.statusCode));
    }

    logger.error("未处理的请求错误", { message: err.message, stack: err.stack });
    return reply.status(500).send(fail("服务器内部错误", 500));
  });

  // ── 404 处理器 ──
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send(fail("请求的接口不存在", 404));
  });

  // ── 路由 ──
  await app.register(ttsRoutes);
  await app.register(novelRoutes);
  await app.register(novelAnalyzeRoutes);
  await app.register(novelConvertRoutes);
  await app.register(novelSpeakerRoutes);
  await app.register(novelAudioRoutes);
  await app.register(voicesRoutes);
  await app.register(healthRoutes);
  await app.register(notificationRoutes);

  // ── 优雅关闭 ──
  const shutdown = () => {
    logger.info("正在关闭服务...");
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info("服务已启动", { port: config.PORT, host: config.HOST });
  } catch (err) {
    logger.error("启动失败", err);
    closeDb();
    process.exit(1);
  }
}

main();







