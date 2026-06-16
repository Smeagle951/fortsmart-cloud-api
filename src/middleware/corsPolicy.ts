import type { CorsOptions } from 'cors';

const DEFAULT_DEV_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
]);

export function createCorsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const isProduction = env.NODE_ENV === 'production';
  const configured = String(env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(configured);

  if (!isProduction) {
    for (const origin of DEFAULT_DEV_ORIGINS) {
      allowedOrigins.add(origin);
    }
  }

  return {
    credentials: true,
    maxAge: 86400,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin not allowed'), false);
    },
  };
}
