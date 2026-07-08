import type { FastifyInstance } from "fastify";
import { routeSchema } from "../swagger-helper.js";
import { success, paginated } from "../utils/response.js";
import { getDb } from "../db/index.js";
interface NotificationRow {
  id: string;
  novel_id: string;
  task_id: string | null;
  type: string;
  title: string;
  message: string | null;
  data: string | null;
  is_read: number;
  created_at: string;
}
export async function notificationRoutes(app: FastifyInstance) {
  // ── 查通知列表 ──
  app.get("/notifications", {
    schema: routeSchema({
      description: "查询通知列表，可按小说筛选，支持未读过滤",
      tags: ["system"],
      summary: "通知列表",
      querystring: {
        type: "object",
        properties: {
          novel_id: { type: "string", description: "小说 ID（可选）" },
          unread_only: { type: "boolean", default: false, description: "是否仅查未读" },
          limit: { type: "integer", default: 50, description: "返回条数" },
        },
      },
      response: {
        "200": {
          description: "查询成功",
          data: {
            type: "object",
            properties: {
              notifications: { type: "object" },
              unread_count: { type: "integer" },
            },
          },
        },
      },
    }),
  }, async (request) => {
    const q = request.query as { novel_id?: string; unread_only?: string; limit?: string };
    const db = getDb();
    let where = "WHERE 1=1";
    const params: unknown[] = [];
    if (q.novel_id) {
      where += " AND novel_id = ?";
      params.push(q.novel_id);
    }
    if (q.unread_only === "true" || q.unread_only === "1") {
      where += " AND is_read = 0";
    }
    const limit = q.limit ? parseInt(q.limit) : 50;
    params.push(limit);
    const rows = db.prepare(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params) as NotificationRow[];
    // 未读计数
    let unreadWhere = "WHERE is_read = 0";
    const unreadParams: unknown[] = [];
    if (q.novel_id) {
      unreadWhere += " AND novel_id = ?";
      unreadParams.push(q.novel_id);
    }
    const unreadRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM notifications ${unreadWhere}`
    ).get(...unreadParams) as { cnt: number };
    const notifications = rows.map((r) => ({
      id: r.id,
      novel_id: r.novel_id,
      task_id: r.task_id,
      type: r.type,
      title: r.title,
      message: r.message,
      data: r.data ? JSON.parse(r.data) : null,
      is_read: r.is_read === 1,
      created_at: r.created_at,
    }));
    return success({
      notifications: paginated(notifications),
      unread_count: unreadRow.cnt,
    });
  });
  // ── 标记单条已读 ──
  app.post("/notifications/read", {
    schema: routeSchema({
      description: "标记指定通知为已读",
      tags: ["system"],
      summary: "标记已读",
      body: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "通知 ID" },
        },
      },
      response: {
        "200": { description: "操作成功", data: { type: "object", properties: { id: { type: "string" } } } },
      },
    }),
  }, async (request) => {
    const { id } = request.body as { id: string };
    const db = getDb();
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
    return success({ id });
  });
  // ── 标记全部已读 ──
  app.post("/notifications/read-all", {
    schema: routeSchema({
      description: "标记某小说的全部通知为已读",
      tags: ["system"],
      summary: "全部已读",
      body: {
        type: "object",
        properties: {
          novel_id: { type: "string", description: "小说 ID（可选，不传则标记全部）" },
        },
      },
      response: {
        "200": { description: "操作成功", data: { type: "object", properties: { count: { type: "integer" } } } },
      },
    }),
  }, async (request) => {
    const { novel_id } = request.body as { novel_id?: string };
    const db = getDb();
    const now = new Date().toISOString();
    let result: { changes: number };
    if (novel_id) {
      result = db.prepare(
        "UPDATE notifications SET is_read = 1 WHERE novel_id = ? AND is_read = 0"
      ).run(novel_id);
    } else {
      result = db.prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0").run();
    }
    return success({ count: result.changes });
  });
}
