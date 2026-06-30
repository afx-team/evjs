import { createApp } from "../app/app.js";
import { createReactFrameworkServer } from "../framework-rendering/react.js";

const framework = createReactFrameworkServer();
const app = createApp(framework ? { framework } : undefined);

export const fetch = app.fetch;

export default { fetch };
