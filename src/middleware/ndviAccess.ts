import type { RequestHandler } from 'express';

/** Legacy spectral operations accept user-supplied geometry, not a sync API key.
 * Campaigns, saved-layer listing and provider diagnostics remain protected.
 */
export function isPublicNdviOperation(method: string, path: string): boolean {
  if (method === 'POST') {
    return /^\/plots\/[^/]+\/(scenes\/search|generate|generate-package)\/?$/.test(path)
      || /^\/(ndvi\/)?generate-package\/?$/.test(path)
      || /^\/imagery\/jobs(\/[^/]+\/retry)?\/?$/.test(path);
  }
  return method === 'GET'
    && /^\/imagery\/jobs\/[^/]+(\/result)?\/?$/.test(path);
}

export function ndviAccess(
  authenticate: RequestHandler,
  authorizeFarm: RequestHandler,
): RequestHandler {
  return (req, res, next) => {
    if (!req.headers.authorization && isPublicNdviOperation(req.method, req.path)) {
      if (req.method === 'POST' && !req.path.endsWith('/retry') && !req.body?.polygon) {
        res.status(400).json({ success: false, code: 'polygon_required',
          message: 'Informe a geometria do talhão para consultar imagens.' });
        return;
      }
      // Public processing must not attach artifacts to a private campaign.
      if (req.body && typeof req.body === 'object') {
        delete req.body.campaign_id;
        delete req.body.campaignId;
      }
      next();
      return;
    }
    // A supplied but invalid credential must never silently become anonymous.
    authenticate(req, res, (error?: unknown) => {
      if (error) { next(error); return; }
      authorizeFarm(req, res, next);
    });
  };
}
