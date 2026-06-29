# 部署

生产部署从 `ev build` 开始。默认情况下，evjs 会把浏览器文件写到 `dist/client`；
当应用使用服务端能力时，还会把服务端文件写到 `dist/server`。

如果希望 evjs 生成平台专属文件，例如 Node server 入口、静态托管 redirects 或 edge
worker，可以使用部署 adapter。

## 生产构建

```bash
npm run build
# 通常执行：ev build
```

典型产物：

```txt
dist/
├── client/
│   ├── manifest.json
│   └── ...
├── server/
│   ├── manifest.json
│   └── ...
└── build-output.json
```

重要路径：

- `dist/client/`：浏览器资源和生成的 HTML。
- `dist/client/manifest.json`：给部署工具消费的浏览器安全路由和资源元信息。
- `dist/server/`：应用使用服务端函数、服务端文件路由、SSR、PPR 或 RSC 时生成的服务端 bundle 和服务端元信息。
- `dist/server/manifest.json`：为了部署兼容保留的轻量 server manifest，包含 server entry
  和服务端处理的 route projection。
- `dist/build-output.json`：面向工具和部署 adapter 的 canonical deployment metadata。应用代码不应导入或修改它。

生成的 HTML 会内嵌浏览器 `ClientRuntime`。手动使用 `@evjs/client` runtime URL API 时仍可从配置的 URL 加载 JSON，但 CLI build 默认不再输出 `dist/client/runtime.json`。
Runtime-only 的 `FrameworkRuntime` 数据通过 build/plugin result 传递，并注入 dev 或 deployment
adapter bootstrap，不再作为默认 JSON artifact 输出。

## 选择部署目标

| 目标 | 适用场景 | Adapter |
| --- | --- | --- |
| 静态托管 | 应用只需要浏览器资源、CSR、MPA client page，或完全静态/SSG 页面。 | `staticDeploymentAdapter()` |
| Node.js | 一个 Node 进程负责资源和全部服务端能力。 | `nodeDeploymentAdapter()` |
| Edge worker | 平台提供 `fetch()` worker 和静态资源 binding。 | `edgeDeploymentAdapter()` |
| CDN + origin 拆分 | 静态资源在 CDN，服务端能力部署在另一个 origin。 | 使用具备服务端能力的 adapter，并配置平台路由。 |

当应用使用服务端函数、服务端文件路由、SSR、PPR 或 RSC 时，不要只部署 `dist/client`。
这些能力需要具备服务端能力的部署目标。

## 运行时路径

服务端运行时路径从 `server.basePath` 派生：

```txt
/__evjs/fn       服务端函数
/__evjs/ppr      存在 PPR 页面时的 PPR 支持端点
/__evjs/rsc      存在 RSC 页面时的 RSC Flight 端点
```

多数应用可以保留默认的 `server.basePath`。只有当宿主平台占用了 `/__evjs`，或反向代理要求其他前缀时，才需要修改它。

PPR 文档请求仍然通过页面 route。PPR 支持端点用于框架/runtime 协作和直接调试，不是用户编写的 API route。

当浏览器资源和服务端运行时位于不同 origin 时，在构建时设置 `transport.baseUrl`：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

## 内置 Adapter

`@evjs/ev` 内置三类部署 adapter：

- `nodeDeploymentAdapter()`：输出 Node server 入口和部署元信息。
- `staticDeploymentAdapter()`：输出静态托管元信息和 `_redirects`。
- `edgeDeploymentAdapter()`：输出 edge worker 入口和部署元信息。

Adapter 基于 evjs 构建结果工作，不应从文件名或 bundler stats 反推框架能力。

## Node.js

普通 Node 服务可以使用 Node adapter 接管生产请求路径：

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

生成的 server 会提供 `dist/client`，处理服务端函数和服务端文件路由，挂载
SSR/PPR/RSC 文档路由，并对客户端导航回退到应用 HTML。默认从 `PORT` 读取端口。

## 静态托管

当应用兼容静态托管时，可以使用 static adapter：

```ts
import { defineConfig, staticDeploymentAdapter } from "@evjs/ev";

export default defineConfig({
  plugins: [staticDeploymentAdapter()],
});
```

adapter 会把静态托管文件写入 public output 目录：

```txt
dist/client/
├── deployment.static.json
└── _redirects
```

生成的 redirects 会把静态或 SSG 页面映射到对应 HTML，并把 app route 映射到应用 HTML
fallback。无路由器 MPA 页面使用精确 rewrite，不会创建全局 catch-all。

如果构建中包含 SSR、PPR、RSC、服务端函数或服务端文件路由，static adapter 仍会输出资源和元信息，
但会在 `deployment.static.json` 中标记静态产物不完整。这种情况下，应用还需要一条具备服务端能力的部署路径。

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

执行 `ev build` 后会生成：

```txt
dist/
├── deployment.edge.json
└── worker.mjs
```

生成的 worker 会把服务端运行时请求和服务端渲染页面请求转发给服务端 bundle，并通过配置的
asset binding 提供浏览器资源。

## Docker

Docker 部署可以使用 Node adapter，并运行生成的 `dist/server.mjs`：

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

## 自定义部署插件

部署插件可以使用 `buildEnd({ deploymentMetadata })` 输出平台文件。需要平台专属兼容字段时，
可以在写文件前包装这份 metadata：

```ts
export function deployAdapter() {
  return {
    name: "deploy-adapter",
    setup() {
      return {
        buildEnd({ deploymentMetadata }) {
          const artifact = {
            ...deploymentMetadata,
            platform: "custom",
          };

          emitPlatformFiles(artifact);
        },
      };
    },
  };
}
```

自定义 adapter 应聚焦平台路由、资源服务、进程或 worker 启动逻辑。应用代码应继续使用 evjs
文件约定，而不是直接读取部署元信息。
