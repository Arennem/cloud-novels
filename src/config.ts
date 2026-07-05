import { config as dotenvConfig } from 'dotenv';
import { ConfigSchema, type Config } from './schemas/config.schema.js';

dotenvConfig();

export const config: Config = ConfigSchema.parse(process.env);
