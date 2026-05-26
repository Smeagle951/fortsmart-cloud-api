import type { NextFunction, Request, Response } from 'express';
export type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function asyncHandler(fn: AsyncRouteHandler): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=asyncHandler.d.ts.map