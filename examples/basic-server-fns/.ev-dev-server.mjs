import { serve } from '@hono/node-server';
import serverModule from './dist/server/index.js';

// Handle CommonJS interop natively
const app = serverModule.default || serverModule;

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log('\x1b[32mev server API ready at http://localhost:' + info.port + '\x1b[0m');
});