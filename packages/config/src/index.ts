import fs from 'node:fs';
import path from 'node:path';

import { envSchema, type Env } from './schema.js';

export { envSchema, type Env };

function loadDotEnv(): void {
  // Walk up from cwd to find the monorepo root .env file.
  // Only loads if the variable is not already set (no override of shell env).
  if (process.env.DATABASE_URL) return;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      // process.loadEnvFile is available since Node 20.12 — we run on Node 22
      (process as NodeJS.Process & { loadEnvFile: (p: string) => void }).loadEnvFile(
        candidate,
      );
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

let _config: Env | undefined;

export function loadConfig(): Env {
  if (_config) return _config;

  loadDotEnv();

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${formatted}\n\nEnsure all required variables are set. See .env.example for reference.`,
    );
  }

  _config = result.data;
  return _config;
}

export function getConfig(): Env {
  if (!_config) {
    return loadConfig();
  }
  return _config;
}
