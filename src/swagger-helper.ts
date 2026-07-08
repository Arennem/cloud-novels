import type { FastifySchema } from 'fastify';

type JsonSchema = Record<string, unknown>;

export function routeSchema(opts: {
  description: string;
  tags: string[];
  summary?: string;
  deprecated?: boolean;
  body?: JsonSchema;
  querystring?: JsonSchema;
  params?: JsonSchema;
  response?: Record<string, { description: string; data?: JsonSchema }>;
}): FastifySchema {
  const schema: FastifySchema = { description: opts.description, tags: opts.tags };
  if (opts.summary) (schema as Record<string, unknown>).summary = opts.summary;
  if (opts.deprecated) (schema as Record<string, unknown>).deprecated = true;
  if (opts.body) schema.body = opts.body;
  if (opts.querystring) schema.querystring = opts.querystring;
  if (opts.params) schema.params = opts.params;
  if (opts.response) {
    schema.response = {};
    for (const [code, resp] of Object.entries(opts.response)) {
      const props: Record<string, unknown> = {
        status: { type: 'integer', description: '业务状态码，0 表示成功' },
        data: resp.data ?? {},
        errorMsg: { type: 'string', nullable: true, description: '错误信息，成功时为 null' },
        timestamp: { type: 'string', description: '响应时间' },
        traceId: { type: 'string', description: '请求追踪 ID' },
      };
      (schema.response as Record<string, unknown>)[code] = {
        description: resp.description,
        type: 'object',
        properties: props,
      };
    }
  }
  return schema;
}
