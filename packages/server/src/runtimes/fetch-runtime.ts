import { createApp } from "../app/create-app.js";
import { createReactFrameworkServer } from "../framework-rendering/react-integration.js";

const framework = createReactFrameworkServer();
const app = createApp(framework ? { framework } : undefined);

export const fetch = app.fetch;

export default { fetch };
