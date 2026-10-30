# 部署

先运行生产构建，再部署浏览器产物，以及应用所需的服务端产物：

```bash
npm run build
# 通常执行：ev build
```

## 选择部署方式

| 目标 | 适用情况 | 内置适配器 |
| --- | --- | --- |
| 静态托管 | 应用使用 CSR、MPA 客户端页面或 SSG，且没有运行时服务端能力 | `staticDeploymentAdapter()` |
| Node.js | 一个 Node 进程提供资源与所有服务端能力 | `nodeDeploymentAdapter()` |
| Edge Worker | 平台提供 Fetch 兼容 Worker 与资源绑定 | `edgeDeploymentAdapter()` |
| CDN + 源站 | 浏览器资源部署在 CDN，服务端能力部署到独立源站 | 服务端适配器加平台路由 |

服务端函数、API 路由、SSR、PPR 与 RSC 都需要服务端目标。任何一项启用时都不要只部署 `dist/client`。

## 理解产物

默认生产布局：

```text
dist/
├── client/                          # HTML、JS、CSS 与公共资源
├── server/                          # 需要时生成服务端包
└── deployment-metadata.json        # 部署工具输入
```

部署适配器可能增加平台入口文件和路由元信息。把 `dist` 下全部文件当作生成产物。

## 静态托管

安装静态适配器：

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";
import { staticDeploymentAdapter } from "@evjs/ev/deployment";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [staticDeploymentAdapter()],
});
```

`ev build` 后，静态主机文件与浏览器产物一起写入：

```text
dist/client/
├── deployment.static.json
└── _redirects
```

重定向把静态页面映射到对应 HTML，并为 SPA 把浏览器路由映射到应用文档。没有浏览器路由器的 MPA 页面使用精确重写，不产生全局 SPA 回退规则。

如果构建包含服务端能力，适配器会把静态产物标记为不完整。可以保留静态文件供 CDN 使用，但还必须把服务端产物部署到兼容运行时。

## Node.js

Node 进程拥有生产请求时使用 Node 适配器：

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";
import { nodeDeploymentAdapter } from "@evjs/ev/deployment";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [nodeDeploymentAdapter()],
});
```

构建会增加：

```text
dist/
├── deployment.node.json
└── server.mjs
```

启动生成的服务端：

```bash
PORT=3000 node dist/server.mjs
```

它提供浏览器资源，处理服务端函数和 API 路由，渲染请求时页面，并在需要时提供 SPA 回退规则。

## Docker

使用 Node 适配器构建，并运行生成服务端：

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

如果运行时依赖被完整打包，项目可能支持更小的最终镜像。在移除安装依赖前，请先确认所选构建器以及全部原生或外部服务端依赖的行为。

## Edge 运行时

主机提供 Fetch 兼容 Worker 与静态资源绑定时使用 Edge 适配器：

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";
import { edgeDeploymentAdapter } from "@evjs/ev/deployment";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    edgeDeploymentAdapter({
      assetsBinding: "ASSETS",
    }),
  ],
});
```

构建会增加：

```text
dist/
├── deployment.edge.json
└── worker.mjs
```

根据主机部署设置，把配置的资源绑定连接到 `dist/client`。Worker 处理服务端请求，并把公共资源委托给该绑定。

## 分别部署浏览器与服务端产物

当 CDN 提供 `dist/client`、独立源站运行服务端产物时，需要在构建配置中让浏览器调用指向服务端源站：

```ts title="ev.config.ts"
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

平台必须路由：

- 服务端函数请求；
- 公共 API 路由路径；
- SSR、PPR 与 RSC 文档请求；
- 使用对应模式时活动的 RSC 或 PPR 支持路径。

静态文件与浏览器路由回退规则保留在 CDN。请显式配置跨域边界的 CORS、Cookie 与凭据策略。

## 运行时路径

框架服务端路径来自 `server.basepath`，默认 `/__evjs`：

```text
/__evjs/fn       服务端函数
/__evjs/ppr      使用 PPR 时的支持路径
/__evjs/rsc      使用 RSC 时的 Flight 路径
```

只有主机或反向代理要求时才修改前缀。公共 API 路由继续使用 `src/apis` 创建的路径。

## 部署检查表

1. 运行 `ev inspect`，确认每条路由与渲染选择。
2. 运行 `ev build` 并保留诊断。
3. 确认是否需要 `dist/server`。
4. 安装目标对应适配器。
5. 验证公共资源、SPA Fallback、API 与请求时页面路由。
6. 仅在来源拆分时设置 `transport.baseUrl`。
7. 在生产环境测试直接打开页面、客户端导航、API 路由以及每种活动服务端渲染模式。

平台作者可以使用公共插件 API 构建自定义部署插件。请从[插件开发](./plugin-authoring)开始，而不是根据生成文件名读取或重建应用路由。
