/**
 * ── 通知管理 ──
 * GET  /notifications           → 通知列表（分页，可按 novel_id / unread 过滤）。
 * POST /notifications/read      → 标记单条通知已读。
 * POST /notifications/read-all  → 标记全部通知已读（可选按 novel_id 限定范围）。
 */
import type { FastifyInstance } from "fastify";
import { success, paginated } from "../utils/response.js";
import { getDb } from "../db/index.js";
import { PaginationSchema } from "../schemas/common.schema.js";
import {
  notificationListSchema,
  notificationReadSchema,
  notificationReadAllSchema,
} from "../route-schemas/notifications.schema.js";

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
  // ── 查通知列表（分页） ──
  app.get("/notifications", { schema: notificationListSchema }, async (request) => {
    const q = request.query as { novel_id?: string; unread_only?: string; pageNum?: string; pageSize?: string };
    const db = getDb();
    const { pageNum, pageSize } = PaginationSchema.parse(request.query);

    let where = "WHERE 1=1";
    const params: unknown[] = [];
    if (q.novel_id) {
      where += " AND novel_id = ?";
      params.push(q.novel_id);
    }
    if (q.unread_only === "true" || q.unread_only === "1") {
      where += " AND is_read = 0";
    }

    // 总数查询
    const countRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM notifications ${where}`
    ).get(...params) as { cnt: number };

    // 分页数据查询
    const offset = (pageNum - 1) * pageSize;
    const dataParams = [...params, pageSize, offset];
    const rows = db.prepare(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...dataParams) as NotificationRow[];

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
      notifications: paginated(notifications, countRow.cnt, pageNum, pageSize),
      unread_count: unreadRow.cnt,
    });
  });

  // ── 标记单条已读 ──
  app.post("/notifications/read", { schema: notificationReadSchema }, async (request) => {
    const { id } = request.body as { id: string };
    const db = getDb();
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
    return success({ id });
  });

  // ── 标记全部已读 ──
  app.post("/notifications/read-all", { schema: notificationReadAllSchema }, async (request) => {
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
