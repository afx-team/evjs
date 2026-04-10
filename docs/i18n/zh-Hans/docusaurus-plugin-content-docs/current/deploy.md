# 部署

构建和部署 evjs 应用需要两部分：提供静态客户端资源和运行服务端函数的 API 服务器。

## 生产构建

```bash
npm run build
```

输出：
- `dist/client/` —— 静态 React SPA 和资源
- `dist/server/` —— 后端服务端函数 bundle
- `dist/client/manifest.json` —— 客户端资源映射和路由元数据
- `dist/server/manifest.json` —— 服务端函数注册表

## CDN 部署 (`assetPrefix`)

如果你在单独的 CDN 而不是应用服务器上托管静态资源，请配置 `ev.config.ts`：

```ts
export default defineConfig({
  assetPrefix: "https://my-cdn.com/assets/"
});
```

在 `ev build` 时，该前缀会被：
1. 作为 Webpack 运行时 `publicPath`（通过 `window.assetPrefix`）—— 所有动态加载的 JS/CSS 分块、图片和字体都会基于该前缀进行解析。
2. 直接写入 `dist/index.html` 的资源标签中。
3. 作为客户端全局 `window.assetPrefix` 运行时变量暴露。你的部署服务器可以在分发 `index.html` 之前安全地动态替换它。

## 方案一：Node.js（默认）

```javascript
// server.mjs
import { serve } from "@evjs/server/node";
import { serveStatic } from "@hono/node-server/serve-static";
import * as serverBundle from "./dist/server/main.js";

const app = serverBundle.createApp();
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ path: "./dist/client/index.html" }));
serve(app, { port: process.env.PORT || 3000 });
```

## 方案二：Docker

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server.mjs .
EXPOSE 3000
CMD ["node", "server.mjs"]
```

## 方案三：Deno

```ts
import { serveStatic } from "hono/deno";
import * as serverBundle from "./dist/server/main.js";

const app = serverBundle.createApp();
app.use("/*", serveStatic({ root: "./dist/client" }));
Deno.serve({ port: 3000 }, app.fetch);
```

## 方案四：Bun

```ts
import * as serverBundle from "./dist/server/main.js";
const app = serverBundle.createApp();
export default { port: 3000, fetch: app.fetch };
```

## 环境变量

服务端密钥（如 `DATABASE_URL`）是安全的 —— 它们只在服务端运行时求值。

:::tip

所有服务端函数代码仅在服务器上运行。客户端 bundle 只包含 RPC 桩代码 —— 你的密钥和业务逻辑永远不会暴露给浏览器。

:::
