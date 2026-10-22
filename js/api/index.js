// api: every call is guarded, mirroring server routes. One namespace, one file per domain.
import { caseApi } from './cases.js';
import { onboardingApi } from './onboarding.js';
import { adminApi } from './admin.js';
import { leadApi } from './leads.js';

export const api = { ...caseApi, ...onboardingApi, ...adminApi, ...leadApi };
