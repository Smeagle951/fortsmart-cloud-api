import type { NextFunction, Request, Response } from 'express';
import { jsonFail } from '../utils/response.js';

export class HttpError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    jsonFail(res, err.message, err.statusCode, err.extra);
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[error]', err);
  jsonFail(res, message, 500);
}
