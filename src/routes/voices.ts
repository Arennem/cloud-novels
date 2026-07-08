import type { FastifyInstance } from 'fastify';
import { routeSchema } from '../swagger-helper.js';
import { success, paginated } from '../utils/response.js';
import { VoicesResponseSchema } from '../schemas/voice.schema.js';

const BUILTIN_VOICES = [
  { id: 'longfei',     name: '龙飞',   gender: 'male'   as const, style: '成熟稳重', language: 'zh-CN' },
  { id: 'longchuan',   name: '龙川',   gender: 'male'   as const, style: '清新自然', language: 'zh-CN' },
  { id: 'longgang',    name: '龙港',   gender: 'male'   as const, style: '温暖亲切', language: 'zh-CN' },
  { id: 'longyu',      name: '龙雨',   gender: 'male'   as const, style: '明亮',     language: 'zh-CN' },
  { id: 'xiaofeng',    name: '晓峰',   gender: 'male'   as const, style: '阳光',     language: 'zh-CN' },
  { id: 'longmiao',    name: '龙妙',   gender: 'female' as const, style: '温柔甜美', language: 'zh-CN' },
  { id: 'longhua',     name: '龙华',   gender: 'female' as const, style: '自然亲切', language: 'zh-CN' },
  { id: 'longyao',     name: '龙瑶',   gender: 'female' as const, style: '知性',     language: 'zh-CN' },
  { id: 'longshuo',    name: '龙硕',   gender: 'male'   as const, style: '厚重沉稳', language: 'zh-CN' },
  { id: 'longxiaochun',name: '龙小春', gender: 'female' as const, style: '活泼',     language: 'zh-CN' },
];

export async function voicesRoutes(app: FastifyInstance) {
  app.get('/voices', {
    schema: routeSchema({
      description: '获取所有内置音色列表',
      tags: ['voice'],
      summary: '音色列表',
      response: { '200': { description: '查询成功', data: {
        type: 'object', properties: {
          voices: { type: 'object', properties: { total: { type: 'integer' }, list: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, gender: { type: 'string' }, style: { type: 'string' }, language: { type: 'string' } } } }, pageNum: { type: 'integer' }, pageSize: { type: 'integer' } } },
        },
      } } },
    }),
  }, async (_request, _reply) => {
    const voices = VoicesResponseSchema.parse({ voices: BUILTIN_VOICES }).voices;
    return success({ voices: paginated(voices) });
  });
}

