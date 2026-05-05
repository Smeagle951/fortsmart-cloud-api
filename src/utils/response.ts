import type { Response } from 'express';

export function jsonOk(res: Response, body: Record<string, unknown>, status = 200): void {
  res.status(status).json({ success: true, ...body });
}

export function jsonFail(
  res: Response,
  message: string,
  status = 400,
  extra?: Record<string, unknown>,
): void {
  res.status(status).json({ success: false, message, ...extra });
}
