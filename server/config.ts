import { ApiError } from './schema.js';

export function studyConfiguration(env = process.env) {
  const provider = env.STUDY_PROVIDER || 'stepfun';
  if (provider === 'stepfun') return { provider: 'StepFun' as const, providerKey: 'STEPFUN_API_KEY' as const, liveAvailable: Boolean(env.STEPFUN_API_KEY?.trim()) };
  throw new ApiError(503, 'Set STUDY_PROVIDER to stepfun in the server configuration, then restart.', 'PROVIDER_CONFIGURATION');
}
