import { jsonFail } from '../utils/response.js';
export class HttpError extends Error {
    statusCode;
    extra;
    constructor(message, statusCode = 400, extra) {
        super(message);
        this.statusCode = statusCode;
        this.extra = extra;
        this.name = 'HttpError';
    }
}
export function errorHandler(err, _req, res, _next) {
    if (err instanceof HttpError) {
        jsonFail(res, err.message, err.statusCode, err.extra);
        return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[error]', err);
    jsonFail(res, message, 500);
}
//# sourceMappingURL=errorHandler.js.map