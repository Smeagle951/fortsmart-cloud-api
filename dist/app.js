import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { syncBaseRouter } from './routes/syncBase.routes.js';
import { windowsBaseRouter } from './routes/windowsBase.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
export function createApp() {
    const app = express();
    app.use(helmet());
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(healthRouter);
    app.use(authRouter);
    app.use(syncBaseRouter);
    app.use(windowsBaseRouter);
    app.use(errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map