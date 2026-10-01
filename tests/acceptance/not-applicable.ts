/**
 * Operations whose success or failure case cannot be exercised meaningfully, keyed by
 * "METHOD /path" exactly as in openapi/openapi.json. Every entry needs a reason; the
 * api-coverage gate (npm run test:api-coverage) accepts only gaps listed here.
 */
export type NotApplicable = { success?: string; failure?: string };

export const NOT_APPLICABLE: Record<string, NotApplicable> = {};
