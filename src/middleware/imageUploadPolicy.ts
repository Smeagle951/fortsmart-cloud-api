import type { FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { HttpError } from './errorHandler.js';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export function assertAllowedImageMimeType(mimeType: string | undefined): void {
  const normalized = String(mimeType ?? '').toLowerCase().trim();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalized)) {
    throw new HttpError('Tipo de arquivo não permitido. Envie JPEG, PNG, WebP, HEIC ou HEIF.', 415);
  }
}

export function imageFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback,
): void {
  try {
    assertAllowedImageMimeType(file.mimetype);
    callback(null, true);
  } catch (error) {
    callback(error as Error);
  }
}
