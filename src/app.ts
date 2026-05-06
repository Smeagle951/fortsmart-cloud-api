import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { syncBaseRouter } from './routes/syncBase.routes.js';
import { syncMonitoringRouter } from './routes/syncMonitoring.routes.js';
import { syncOperationalRouter } from './routes/syncOperational.routes.js';
import { windowsBaseRouter } from './routes/windowsBase.routes.js';
import { windowsOperationalRouter } from './routes/windowsOperational.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp(): express.Application {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(syncBaseRouter);
  app.use(syncMonitoringRouter);
  app.use(syncOperationalRouter);
  app.use(windowsBaseRouter);
  app.use(windowsOperationalRouter);

  app.use(errorHandler);
  return app;
}
