// /api/horizons — stub created with the app shell (T-3). Owner: @analysis (replace this file).
// Handler contract: server/plugin.ts (ApiRequest -> ApiResponse). Runs server-side only.
import type { ApiHandler } from '../plugin';

const handler: ApiHandler = () => ({ status: 501, json: { error: '/api/horizons is not implemented yet.' } });

export default handler;
