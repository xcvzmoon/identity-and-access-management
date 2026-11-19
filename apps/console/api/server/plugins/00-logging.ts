import { definePlugin } from 'nitro';
import { registerApiLogging } from '../../../../../shared/server/api-logging.ts';

export default definePlugin((app) => {
  registerApiLogging(app, 'iam-console-api');
});
