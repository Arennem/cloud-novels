import type { FastifyRequest } from "fastify"

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
 * - Multipart 模式（依赖 @fastify/multipart attachFieldsToBody）：
 *   body 中每个字段为 MultipartValue 或 MultipartFile 对象。文本字段取 .value，
 *   文件字段取 ._buf (preValidation hook 中已由 toBuffer() 填充) 转为 utf-8 作为 fileContent 返回。
 */
export async function parseUploadRequest(request: FastifyRequest): Promise<ParsedUploadBody> {
  const body = request.body as Record<string, unknown>
  const fields: Record<string, string> = {}
  let fileContent: string | null = null

  for (const [key, value] of Object.entries(body)) {
    if (value !== null && value !== undefined && typeof value === "object") {
      // @fastify/multipart attachFieldsToBody 模式下，字段是 MultipartValue 或 MultipartFile
      // 两者都有 circular 的 "fields" 引用，用来区分 multipart 条目与普通 JSON 对象
      if ("fields" in (value as object)) {
        const entry = value as {
          value?: string
          filename?: string
          _buf?: Buffer | null
          toBuffer?: () => Promise<Buffer>
        }

        if (entry.filename) {
          // 文件字段：取第一个上传文件的内容
          if (fileContent === null) {
            // _buf 已在 preValidation hook 中由 toBuffer() 调用填充
            const buf = entry._buf ?? (entry.toBuffer ? await entry.toBuffer() : null)
            if (buf) {
              fileContent = buf.toString("utf-8")
            }
          }
        } else if (entry.value !== undefined) {
          // 文本字段（如 novel_title）：取 .value
          fields[key] = entry.value
        }
      }
    } else if (typeof value === "string") {
      // JSON 模式下的纯字符串字段
      fields[key] = value
    } else if (value !== null && value !== undefined) {
      fields[key] = JSON.stringify(value)
    }
  }

  return { fields, fileContent }
}
