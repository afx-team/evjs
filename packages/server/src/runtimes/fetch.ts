import { createApp } from "../app.js";
import { createReactFrameworkServer } from "../react.js";

const framework = createReactFrameworkServer();
const app = createApp(framework ? { framework } : undefined);

export default { fetch: app.fetch };
