import type { Response } from 'express';
export declare function jsonOk(res: Response, body: Record<string, unknown>, status?: number): void;
export declare function jsonFail(res: Response, message: string, status?: number, extra?: Record<string, unknown>): void;
//# sourceMappingURL=response.d.ts.map