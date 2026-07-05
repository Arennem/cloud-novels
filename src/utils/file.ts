import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

export function ensureDir(dir: string): void {
  const abs = resolve(dir);
  if (!existsSync(abs)) {
    mkdirSync(abs, { recursive: true });
  }
}
