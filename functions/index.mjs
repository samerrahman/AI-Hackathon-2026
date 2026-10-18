import { onRequest } from 'firebase-functions/v2/https';
import { app } from './lib/app.mjs';

export const api = onRequest({
  region: 'us-central1',
  timeoutSeconds: 60,
  memory: '512MiB',
  minInstances: 0,
  maxInstances: 2,
  secrets: ['STEPFUN_API_KEY', 'SESSION_SECRET'],
}, app);
