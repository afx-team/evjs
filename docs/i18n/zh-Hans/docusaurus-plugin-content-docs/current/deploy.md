# 部署

evjs 生产构建包含静态资源、可选服务端 bundle，以及框架 manifest。

```txt
dist/
├── client/
│   └── manifest.json
├── server/
│   └── manifest.json
└── build-output.json
```

启用 server 时，部署 adapter 应消费 `BuildOutput`，并从中派生平台特定路由或资源
manifest。运行在构建流水线里的 adapter 会直接收到这个对象；构建后的工具可以从
`dist/build-output.json` 读取同一份完整模型。`dist/server/manifest.json` 只是派生出的
server bundle metadata 视图，不能替代 `BuildOutput`。CSR-only 构建继续使用扁平的
`dist/manifest.json`。

## 生产构建

```bash
npm run build
# 通常执行：ev build
```

重要输出：

- `dist/client/manifest.json`：浏览器安全的 apps、pages、routes、assets 和 runtime paths；
- `dist/server/manifest.json`：派生出的 server bundle metadata；
- `dist/build-output.json`：面向工具和调试的私有完整 BuildOutput handoff；
- `dist/client/`：浏览器资源和 HTML；
- `dist/server/`：启用 `server` 时的框架服务端 bundle。

如果页面 HTML 没有内嵌 `__EVJS_MANIFEST__`，浏览器 runtime 会从
`manifestUrl`、`data-evjs-manifest` 或 `/manifest.json` 获取框架 manifest。
部署时应把该响应作为成功的 JSON 返回，并使用
`Content-Type: application/json`，允许附带可选 content-type 参数。

## 能力模型

部署应由框架能力决定，而不是由产物来自哪个 bundler 决定。Deployment adapter 应从
manifest 中识别这些 runtime requirements：

| 能力 | 公开入口 | 所需 runtime | 说明 |
| --- | --- | --- | --- |
| 静态资源 | `dist/client/*` | CDN/静态文件服务 | 按文件名缓存即可。 |
| CSR app routes | app HTML fallback | 静态或服务端 | 不使用服务端能力时，静态 rewrite 足够。 |
| MPA entry pages | page HTML file | 静态或服务端 | 用户自控 client entry 或 SSG/static HTML 页面可静态托管。 |
| SSG pages | page HTML file | 静态或服务端 | 若不依赖动态服务端 API，可静态托管。 |
| SSR pages | page route | 需要服务端能力 | route 必须到达 framework server bundle。 |
| PPR pages | page route | 服务端能力或 edge+origin | 浏览器请求 page route；region resolution 可本进程或 server-to-server。 |
| RSC pages | page route + `runtime.server.rsc` | 需要服务端能力 | document route 与 Flight endpoint 必须共享兼容 manifest/assets。 |
| Server functions | `runtime.server.fn` | 需要服务端能力 | 通常与 SSR/RSC/PPR 共用同一个 origin/base path，除非用 `transport.baseUrl` 拆分。 |
| Server routes | 声明的 route path | 需要服务端能力 | methods 与 405 行为属于 `@evjs/server`。 |

由此得到四类实际部署拓扑：

1. **Static-only**：CSR、MPA client entries、SSG/static HTML 页面 和静态资源。不包含 server functions、SSR、PPR、RSC 或 server routes。
2. **Unified Node**：一个 Node 进程提供 `dist/client`、framework endpoints、
   SSR/PPR/RSC document routes、server functions 和 server routes。
3. **Unified Edge Worker**：一个 edge worker 从 binding 提供资源，并把 framework
   请求交给 edge-compatible server bundle。
4. **Edge + Origin/FaaS split**：CDN/edge 负责资源和缓存 shell；内源 origin/FaaS
   负责 server functions、SSR/RSC rendering 和 PPR dynamic regions。

长期 adapter contract 是：

```txt
BuildOutput
  -> classify required capabilities
  -> map public asset root
  -> map framework endpoints
  -> map document routes
  -> map server routes
  -> emit platform routing/artifacts
```

Adapter 不应从文件名或 bundler stats 反推这些能力。

## Runtime 路径

框架服务端 endpoint 从 `server.basePath` 派生：

```txt
/__evjs/fn       服务端函数
/__evjs/ppr      存在 PPR 页面时的 region direct/debug endpoint
/__evjs/rsc      启用 server.rsc 时的 Flight endpoint
```

RSC Flight response 默认使用 `Cache-Control: no-store`；renderer 显式返回的
cache headers 会被保留。

PPR 文档请求通过页面 route 服务；PPR endpoint 主要用于 direct/debug 访问和 fallback
adapter，不是默认浏览器首屏协议。

如果生产部署把 PPR shell 缓存在 edge，而 dynamic regions 部署在内源 FaaS/origin，
浏览器侧协议仍然应该保持为页面 route：

```txt
Browser
  GET /campaign
    -> Edge/CDN
       load cached shell
       read manifest PPR region metadata
       server-to-server GET /__evjs/ppr/campaign/region_a1b2c3d4e5f6
         -> Internal FaaS/origin renders region fragment
       merge 或 stream region 到同一个 /campaign response
    <- Browser receives one document response
```

在这个拓扑下，`/__evjs/ppr/<page>/<region>` 不是浏览器首屏请求，而是 edge/runtime
层使用的内部 region resolver endpoint。direct endpoint 在 PPR base path 后只精确匹配
两个编码后的 path segment：`<pageId>/<regionId>`，其中 `regionId` 是 opaque
internal manifest id，不是用户编写 API。源模块通过
`prerender.delivery = "merge"` 声明等待必要 regions 后再返回 document；通过
`prerender.delivery = "stream"` 声明先 flush 缓存 shell，并在内部 region 请求完成后把
patches 继续写入同一个 HTML response。
合成后的 PPR page response 会根据 region 策略得到保守的默认 `Cache-Control`：
任意 region 动态时使用 `no-store`；所有 regions 都声明 `{ revalidate }` 时使用最小的
region `s-maxage`。shell 显式返回的 `Cache-Control` 会被保留。
PPR direct `HEAD` 请求可以返回 cache headers，但不会写入 region body cache；
部署侧需要预热 PPR region 时应使用 `GET`。
拆分式 edge/origin adapter 可以提供 `framework.ppr.regionCache`，用平台 cache、
KV store 或区域内存缓存来承载 PPR region body cache。设置
`framework.ppr.staleWhileRevalidate` 后，仍在 stale 窗口内的过期 entry 会以
`x-evjs-cache: STALE` 返回；如果平台暴露 `waitUntil()`，运行时会用它在后台刷新缓存。
Cache provider 失败会被记录，并退回到 fresh render。

如果浏览器和服务端在不同 origin，构建时配置 `transport.baseUrl`。

## 路由优先级

具备服务端能力的 adapter 应按这个顺序处理路由：

```txt
1. dist/client 中的 immutable/static assets
2. framework endpoints: runtime.server.fn, runtime.server.ppr, runtime.server.rsc
3. BuildOutput.server.routes 中的显式 server routes
4. framework document routes: SSR, PPR, RSC，以及 server-rendered SSG fallback
5. CSR navigation 的 app/page HTML fallback
6. 404
```

Static-only adapter 只应为无需服务端即可运行的能力生成 redirects。如果 `BuildOutput`
包含 SSR、PPR、RSC、server functions 或 server routes，static adapter 仍可以输出
静态资源和 metadata，但不能声明整个应用仅靠静态托管即可完整运行。此时
`deployment.static.json` 会记录 `metadata.static.complete = false` 以及不支持的能力，
`_redirects` 也不会输出全局 catch-all fallback，避免把需要服务端的路由误导到
`index.html`。
`rendering.prerender = "full"` 是构建 metadata，本身不等于静态交付保证；
static-only routing 只使用 manifest 中 `rendering.html = "static"` 的页面，例如
`render = "ssg"` 页面。

## 内置 Adapter

`@evjs/ev` 内置三类部署 adapter：

- `nodeDeploymentAdapter()`：输出 Node server 入口和 deployment metadata。
- `staticDeploymentAdapter()`：输出 deployment metadata 以及静态托管可用的 `_redirects`。
- `edgeDeploymentAdapter()`：输出 deployment metadata 以及 edge worker module；worker
  将框架请求转发给服务端 bundle，将静态资源交给 asset binding。

三类 adapter 都从 `BuildOutput` 派生，不读取 bundler stats 或 bundler config。
对于 `/assets/` 这类 root-relative 且非根的 `publicPath`，生成的 Node 和 edge
module 会在从 `dist/client` 或 asset binding 解析文件前剥离该 URL 前缀。绝对
CDN public path 不会被改写，因为这类资源请求应在 CDN 终止。

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
fallback。Router-free MPA pages 只生成精确 route rewrite，不会创建全局 catch-all。
只有构建产物完全兼容静态托管且存在 app-owned HTML fallback 时，才会输出全局 `/*`
fallback。SSR、PPR、RSC、server functions 和显式 server routes 仍然需要具备服务端能力的
adapter，并会列在 `deployment.static.json` 的
`metadata.static.unsupportedCapabilities` 中。

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

构建后的工具可以在启用 server 时读取 `dist/build-output.json`。运行在 `ev build`
过程中的 adapter 会在内存里收到同一份 `BuildOutput`，并可以内嵌所需 runtime 数据。
CSR-only 构建使用扁平的 `dist/manifest.json`。
