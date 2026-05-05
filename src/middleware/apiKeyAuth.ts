import type { NextFunction, Request, Response } from 'express';
import { authenticateBearer, touchLastUsed } from '../services/apiKey.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const requireApiKey = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const row = await authenticateBearer(req.headers.authorization);
  req.cloudAuth = { apiKeyId: row.id, farmId: row.farm_id };
  await touchLastUsed(row.id);
  next();
});
