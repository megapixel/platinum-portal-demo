// api: every call is guarded, mirroring server routes. One namespace, one file per domain.
import { caseApi } from './cases.js';
import { onboardingApi } from './onboarding.js';
import { adminApi } from './admin.js';
import { leadApi } from './leads.js';
import { consolidationApi } from './consolidation.js';
import { messagingApi } from './messaging.js';

export const api = { ...caseApi, ...onboardingApi, ...adminApi, ...leadApi, ...consolidationApi, ...messagingApi };
