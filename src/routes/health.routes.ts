import { Router } from 'express';
import { jsonOk } from '../utils/response.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  jsonOk(res, { status: 'ok' });
});
