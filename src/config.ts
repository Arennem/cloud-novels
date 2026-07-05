import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ConfigSchema, type Config } from './schemas/config.schema.js';

// 加载基础 .env（本地开发用，含敏感信息，已 gitignore）
dotenvConfig();

// 按 NODE_ENV 加载环境特定文件，覆盖同名变量
const env = process.env.NODE_ENV ?? 'development';
const envFile = resolve(`.env.${env}`);
if (existsSync(envFile)) {
  dotenvConfig({ path: envFile, override: true });
}

export const config: Config = ConfigSchema.parse(process.env);
