import type { FastifyInstance } from "fastify";
import { healthCheckSchema } from "../route-schemas/health.schema.js";
import { success } from "../utils/response.js";
import { novelManager } from "../services/novel_manager.js";
import { speakerManager } from "../services/speaker_manager.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", { schema: healthCheckSchema }, async () => success({
    novels_count: novelManager.countAll(),
    speakers_count: speakerManager.listAllSpeakers().length,
  }));
}
