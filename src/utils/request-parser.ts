import type { FastifyRequest } from "fastify";

export interface ParsedUploadBody {
  fields: Record<string, string>;
  /** 如果请求中包含文件上传，将文件内容转为 utf-8 文本 */
  fileContent: string | null;
}

/**
 * 统一解析上传请求，兼容 JSON body 和 multipart/form-data 两种格式。
 *
 * - JSON 模式：直接读取 body，所有 string 字段存入 fields，
 *   非 string 字段（如 object）JSON.stringify 后存入 fields。
 * - Multipart 模式：遍历所有 field 和 file 部件，
 *   第一个文件内容读取为 utf-8 文本返回，field 值存入 fields。
 */
export async function parseUploadRequest(request: FastifyRequest): Promise<ParsedUploadBody> {
  const contentType = request.headers["content-type"] ?? "";

  if (contentType.includes("multipart/form-data")) {
    const parts = request.parts();
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === "field") {
        fields[part.fieldname] = part.value as string;
      } else if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
      }
    }

    return {
      fields,
      fileContent: fileBuffer ? fileBuffer.toString("utf-8") : null,
    };
  }

  // JSON body
  const body = request.body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      fields[key] = value;
    } else if (value !== null && value !== undefined) {
      fields[key] = JSON.stringify(value);
    }
  }

  return { fields, fileContent: null };
}
