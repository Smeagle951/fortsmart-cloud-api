import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { syncBaseRouter } from './routes/syncBase.routes.js';
import { windowsBaseRouter } from './routes/windowsBase.routes.js';
import { syncOperationalRouter } from './routes/syncOperational.routes.js';
import { windowsOperationalRouter } from './routes/windowsOperational.routes.js';
import { syncMonitoringRouter } from './routes/syncMonitoring.routes.js';
import { syncDecisionInsightsRouter } from './routes/syncDecisionInsights.routes.js';
import { monitoringMediaRouter } from './routes/monitoringMedia.routes.js';
import { plantingMediaRouter } from './routes/plantingMedia.routes.js';
import { createSoilSamplingNdviRouter } from './routes/soilSamplingNdvi.mount.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp(): express.Application {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(syncBaseRouter);
  app.use(windowsBaseRouter);
  app.use(syncOperationalRouter);
  app.use(syncDecisionInsightsRouter);
  app.use(windowsOperationalRouter);
  app.use(syncMonitoringRouter);
  // Upload multipart (também montado em syncOperationalRouter; duplicado para deploys parciais).
  app.use(monitoringMediaRouter);
  app.use(plantingMediaRouter);

  const ndviRouter = createSoilSamplingNdviRouter();
  app.use('/api/soil-sampling/ndvi', ndviRouter);
  app.use('/soil-sampling/ndvi', ndviRouter);

  app.use(errorHandler);
  return app;
}
