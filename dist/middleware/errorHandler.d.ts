import type { NextFunction, Request, Response } from 'express';
export declare class HttpError extends Error {
    statusCode: number;
    extra?: Record<string, unknown> | undefined;
    constructor(message: string, statusCode?: number, extra?: Record<string, unknown> | undefined);
}
export declare function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void;
//# sourceMappingURL=errorHandler.d.ts.map