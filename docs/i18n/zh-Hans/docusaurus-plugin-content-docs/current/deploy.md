# 部署

evjs 生产构建包含静态资源、可选服务端 bundle，以及单一框架 manifest。

```txt
dist/
├── client/
├── server/
└── manifest.json
```

部署 adapter 应消费 `dist/manifest.json` / `BuildOutput`，并从中派生平台特定路由或资源 manifest。

## 生产构建

```bash
npm run build
# 通常执行：ev build
```

重要输出：

- `dist/manifest.json`：apps、pages、routes、assets、server functions、server routes、remotes 和 runtime paths；
- `dist/client/`：浏览器资源和 HTML；
- `dist/server/`：启用 `server` 时的框架服务端 bundle。

## Runtime 路径

框架服务端 endpoint 从 `server.basePath` 派生：

```txt
/__evjs/fn       服务端函数
/__evjs/ppr      存在 PPR 页面时的 region direct/debug endpoint
/__evjs/rsc      启用 server.rsc 时的 Flight endpoint
```

PPR 文档请求通过页面 route 服务；PPR endpoint 主要用于 direct/debug 访问和 fallback
adapter，不是默认浏览器首屏协议。

如果浏览器和服务端在不同 origin，构建时配置 `transport.baseUrl`。

## 内置 Adapter

`@evjs/ev` 内置三类部署 adapter：

- `nodeDeploymentAdapter()`：输出 Node server 入口和 deployment metadata。
- `staticDeploymentAdapter()`：输出 deployment metadata 以及静态托管可用的 `_redirects`。
- `edgeDeploymentAdapter()`：输出 deployment metadata 以及 edge worker module；worker
  将框架请求转发给服务端 bundle，将静态资源交给 asset binding。

三类 adapter 都从 `BuildOutput` 派生，不读取 bundler stats 或 bundler config。

## Node.js

普通 Node 服务可以直接使用内置 Node 部署 adapter：

```ts
// ev.config.ts
import { defineConfig, nodeDeploymentAdapter } from "@evjs/ev";

export default defineConfig({
  plugins: [nodeDeploymentAdapter()],
});
```

执行 `ev build` 后会生成：

```txt
dist/
├── deployment.node.json
└── server.mjs
```

运行生成的服务：

```bash
node dist/server.mjs
```

生成的 server 会把框架服务端 bundle 挂在 `server.basePath`，挂载
SSR/PPR/RSC 文档路由和显式 server routes，提供 `dist/client` 静态资源，
并对客户端路由回退到 app HTML。

如果需要完全自定义，等价结构如下：

```js
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@evjs/server/node";
import serverHandler from "./dist/server/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, "dist/client");

const app = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__evjs/") || url.pathname === "/dashboard") {
      return serverHandler.fetch(request);
    }

    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    try {
      return new Response(await readFile(path.join(clientRoot, file)));
    } catch {
      return new Response(await readFile(path.join(clientRoot, "index.html")));
    }
  },
};

serve(app, { port: Number(process.env.PORT ?? 3000) });
```

如果 `server.basePath` 不是 `/__evjs`，需要同步调整挂载路径。

## 静态托管

只需要静态路由 metadata 时，可以使用 static adapter：

```ts
import { defineConfig, staticDeploymentAdapter } from "@evjs/ev";

export default defineConfig({
  plugins: [staticDeploymentAdapter()],
});
```

adapter 会输出：

```txt
dist/
├── deployment.static.json
└── _redirects
```

生成的 redirects 会把静态/SSG 页面映射到对应 HTML，把 app route 映射到 app HTML
fallback。SSR、PPR、RSC、server functions 和显式 server routes 仍然需要具备服务端能力的 adapter。

## Edge Runtime

当平台提供 `fetch()` worker 和静态资源 binding 时，可以使用 edge adapter：

```ts
import { defineConfig, edgeDeploymentAdapter } from "@evjs/ev";

export default defineConfig({
  plugins: [
    edgeDeploymentAdapter({
      assetsBinding: "ASSETS",
    }),
  ],
});
```

adapter 会输出：

```txt
dist/
├── deployment.edge.json
└── worker.mjs
```

生成的 worker 会从 `dist/server` 导入服务端 bundle，将 framework 请求和
SSR/PPR/RSC 文档请求转发给该 bundle，并通过配置的 binding 提供浏览器资源。

## Docker

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
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
```

## 部署插件

部署插件应使用 `buildOutput()` 或 `buildEnd({ output })`。平台专属文件可以
从 `createDeploymentArtifact()` 派生：

```ts
import { createDeploymentArtifact } from "@evjs/ev";

export function deployAdapter() {
  return {
    name: "deploy-adapter",
    setup() {
      return {
        buildOutput(output) {
          output.deployment = {
            platform: "custom",
            publicPath: output.publicPath,
            server: output.runtime.server,
          };
        },
        buildEnd({ output }) {
          emitPlatformFiles(createDeploymentArtifact(output, {
            platform: "custom",
          }));
        },
      };
    },
  };
}
```

不要读取旧 client/server manifest 文件；它们不是新架构的框架契约。
