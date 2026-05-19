import { Router } from 'express';
import type { Request } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { authenticateBearer, DEFAULT_MODULES, regenerateRawApiKeyForFarm, touchLastUsed } from '../services/apiKey.service.js';
import {
  consumePairingSession,
  createPairingSession,
  getPairingSessionStatus,
  listTrustedDevices,
  revokePairingSession,
  revokeTrustedDevice,
  validateDeviceBinding,
} from '../services/pairing.service.js';
import { getPool } from '../db/pool.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';

export const authRouter = Router();

const NOT_LINKED_MSG =
  'API Key válida. Primeira sincronização ainda não vinculou uma fazenda.';

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || null;
}

function userAgent(req: Request): string | null {
  return typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
}

authRouter.post(
  '/auth/api-key/regenerate',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';
    const farmId =
      typeof body?.farm_cloud_id === 'string' && body.farm_cloud_id.trim()
        ? body.farm_cloud_id.trim()
        : typeof body?.farm_id === 'string'
          ? body.farm_id.trim()
          : '';
    if (!apiKey) throw new HttpError('api_key is required', 400);
    if (!farmId) throw new HttpError('farm_id or farm_cloud_id is required', 400);

    const result = await regenerateRawApiKeyForFarm({
      rawKey: apiKey,
      farmIdOrCloudId: farmId,
      name: typeof body?.name === 'string' ? body.name : undefined,
    });

    jsonOk(res, {
      message: result.farm_id
        ? 'API Key registrada e vinculada à fazenda.'
        : 'API Key registrada. Ela será vinculada no primeiro push da fazenda.',
      key_id: result.key_id,
      farm_id: result.farm_id,
      key_prefix: result.key_prefix,
      created_at: result.created_at,
    });
  }),
);

authRouter.post(
  '/auth/api-key/validate',
  asyncHandler(async (req, res) => {
    const row = await authenticateBearer(req.headers.authorization);

    const body = req.body as Record<string, unknown> | undefined;
    const deviceId =
      String(req.headers['x-fortsmart-device-id'] ?? '').trim() ||
      (typeof body?.device_id === 'string' ? body.device_id.trim() : '');
    await validateDeviceBinding({
      apiKeyHash: row.key_hash,
      farmId: row.farm_id,
      deviceId,
    });
    await touchLastUsed(row.id);

    const farmIdParam =
      typeof body?.farm_id === 'string'
        ? body.farm_id.trim()
        : body?.farm_id != null
          ? String(body.farm_id).trim()
          : '';
    if (!farmIdParam) {
      throw new HttpError('farm_id is required', 400);
    }

    const modules = [...DEFAULT_MODULES];

    if (row.farm_id === null) {
      jsonOk(res, {
        connected: false,
        message: NOT_LINKED_MSG,
        modules,
      });
      return;
    }

    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      local_id: string;
      name: string;
    }>(
      `SELECT id, local_id, name FROM farms
       WHERE (id::text = $1 OR local_id = $1) AND deleted_at IS NULL
       LIMIT 1`,
      [farmIdParam],
    );
    const farm = rows[0];
    if (!farm) {
      throw new HttpError('Farm not found', 404);
    }
    if (farm.id !== row.farm_id) {
      throw new HttpError('farm_id does not match this API key', 403);
    }

    jsonOk(res, {
      connected: true,
      farm: {
        id: farm.id,
        name: farm.name,
        local_id: farm.local_id,
      },
      modules,
    });
  }),
);

authRouter.post(
  '/auth/pairing/create',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const farmCloudId =
      typeof body?.farm_cloud_id === 'string' ? body.farm_cloud_id.trim() : req.cloudAuth?.farmId ?? '';
    const desktopInstallationId =
      typeof body?.desktop_installation_id === 'string' ? body.desktop_installation_id.trim() : '';
    const result = await createPairingSession({
      apiKeyFarmId: req.cloudAuth?.farmId ?? null,
      farmCloudId,
      desktopInstallationId,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    jsonOk(res, result);
  }),
);

authRouter.post(
  '/auth/pairing/consume',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const result = await consumePairingSession({
      pairingToken: typeof body?.pairing_token === 'string' ? body.pairing_token : undefined,
      pairingCode: typeof body?.pairing_code === 'string' ? body.pairing_code : undefined,
      farmLocalId: typeof body?.farm_local_id === 'string' ? body.farm_local_id : undefined,
      deviceId: typeof body?.device_id === 'string' ? body.device_id : '',
      appVersion: typeof body?.app_version === 'string' ? body.app_version : null,
      platform: typeof body?.platform === 'string' ? body.platform : null,
      deviceName: typeof body?.device_name === 'string' ? body.device_name : null,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    jsonOk(res, result);
  }),
);

authRouter.get(
  '/auth/pairing/session/:id',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const result = await getPairingSessionStatus({
      apiKeyFarmId: req.cloudAuth?.farmId ?? null,
      sessionId: req.params.id,
    });
    jsonOk(res, result);
  }),
);

authRouter.post(
  '/auth/pairing/revoke',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const sessionId = typeof body?.pairing_session_id === 'string' ? body.pairing_session_id.trim() : '';
    if (!sessionId) throw new HttpError('pairing_session_id is required', 400);
    await revokePairingSession({
      apiKeyFarmId: req.cloudAuth?.farmId ?? null,
      sessionId,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    jsonOk(res, { revoked: true });
  }),
);

authRouter.get(
  '/auth/trusted-devices',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const devices = await listTrustedDevices(req.cloudAuth?.farmId ?? null);
    jsonOk(res, { devices });
  }),
);

authRouter.post(
  '/auth/trusted-devices/revoke',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const deviceId = typeof body?.device_id === 'string' ? body.device_id.trim() : '';
    if (!deviceId) throw new HttpError('device_id is required', 400);
    await revokeTrustedDevice({
      apiKeyFarmId: req.cloudAuth?.farmId ?? null,
      deviceId,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    jsonOk(res, { revoked: true });
  }),
);
