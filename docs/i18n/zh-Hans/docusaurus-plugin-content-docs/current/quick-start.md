# 快速开始

## 创建新项目

```bash
npx @evjs/create-app my-app
cd my-app && npm install
```

两个参数都是可选的 —— 省略时 CLI 会交互式提示。

### 可用模板

| 模板 | 描述 |
|------|------|
| `basic` | 路由 + 服务端函数 |
| `mpa` | 多页面应用模板 |
| `api-routes` | 通过 `createRoute()` 构建程序化 REST API |
| `complex-routing` | 参数、搜索、布局、加载器、嵌套路由 |
| `with-tailwind` | 通过 PostCSS 使用 Tailwind CSS |
| `with-trpc` | tRPC 互操作示例 |
| `with-sqlite` | 基于 SQLite 的全栈 CRUD |
| `custom-ws-transport` | 自定义 WebSocket 传输层 |
| `plugin-authoring` | 插件生命周期与构建器钩子示例 |

## 开发

```bash
ev dev
```

浏览器将自动打开 `http://localhost:3000`，支持热模块替换。显式 app/page/server 根下的 `"use server"` 模块会被自动发现。

## 生产构建

```bash
ev build
```

## 项目结构

```
my-app/
├── index.html              # HTML 模板（必须包含 <div id="app">）
├── ev.config.ts            # 可选配置
├── src/
│   ├── main.tsx            # 应用启动
│   ├── pages/              # TanStack route modules 或页面组件
│   │   ├── __root.tsx      # 根布局
│   │   └── home.tsx        # 首页路由
│   └── api/                # 服务端模块
│       ├── users.server.ts # "use server" 函数
│       └── health.routes.ts
├── package.json
└── tsconfig.json
```

## 使用 TanStack Router 的启动代码

```tsx
// src/main.tsx
import { createApp } from "@evjs/client";
import { rootRoute } from "./pages/__root";
import { homeRoute } from "./pages/home";
const routeTree = rootRoute.addChildren([homeRoute]);
const app = createApp({ routeTree });

declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

TanStack Router 是默认模板路径，因为它提供强类型路由和 loader 集成。新架构能力也可以通过 framework route declaration 或 standalone `pages` 表达。

## 不使用 TanStack 的路由声明

```ts
// src/app.tsx
import { defineReactApp, route } from "@evjs/client";
import Campaign from "./pages/Campaign";
import Dashboard from "./pages/Dashboard";

function App() {
  return <main>Operations console</main>;
}

export default defineReactApp({
  html: "../index.html",
  mount: "#app",
  component: App,
  routes: [
    route("/dashboard", Dashboard, {
      id: "dashboard",
    }),
    route("/campaign", Campaign, {
      id: "campaign",
    }),
  ],
});
```

```tsx
// src/pages/Dashboard.tsx
export const render = "ssr";
export const hydrate = "load";

export default function Dashboard() {
  return <main>Server-rendered dashboard</main>;
}
```

```tsx
// src/pages/Campaign.tsx
import { Suspense } from "react";
import { OfferRegion } from "./OfferRegion";
import { OfferSkeleton } from "./OfferSkeleton";

export const render = "ssr";
export const hydrate = "none";
export const prerender = {
  partial: true,
  delivery: "stream",
} as const;

export default function Campaign() {
  return (
    <main>
      <Suspense fallback={<OfferSkeleton />}>
        <OfferRegion />
      </Suspense>
    </main>
  );
}
```

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  app: "./src/app.tsx",
});
```

这个 app declaration source 是构建时 graph source。route groups 仍然可以拆到被它 import 的文件里，但 `ev.config.ts` 只指向 app 边界。

## 包列表

| 包 | 用途 |
|---|------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | 框架 API、配置、插件和构建编排 (`defineConfig`, `dev`, `build`) |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | 注入默认构建器的轻量 CLI 包装 (`ev dev`, `ev build`) |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | 项目脚手架 (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | 浏览器运行时、transport、page runtime、shell 导出、静态 route helpers 和 TanStack 兼容能力 |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | Hono/fetch 服务端运行时、服务端函数、路由和 SSR/PPR/RSC 请求处理 |

Manifest schema、build tools、page runtime、shell 和 route DSL 都是上述公开包内部的实现模块。
应用代码通常应从 `@evjs/ev`、`@evjs/client` 和 `@evjs/server` 导入。

## 必需依赖

```json
{
  "dependencies": {
    "@evjs/client": "<same version>",
    "@evjs/server": "<same version>",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@evjs/ev": "<same version>",
    "@evjs/cli": "<same version>",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^6.0.2"
  }
}
```

:::important

应用中的所有 `@evjs/*` 包必须保持相同版本。升级 evjs 时，请同时升级 `@evjs/client`、`@evjs/server`、`@evjs/ev`、`@evjs/cli` 以及其他 `@evjs/*` 包。

:::

## 重要规则

- 配置文件：`ev.config.ts`（不是 `evjs.config.ts`）
- 从 `@evjs/ev` 导入 `defineConfig`，不是从 `@evjs/server`
- HTML 必须包含 `<div id="app">` 作为渲染目标
- 不要在你的**项目** `package.json` 中添加 `"type": "module"` —— 服务端 bundle 使用 CJS 格式
- `src/main.tsx` 应保持精简；将 app graph 声明放在 `src/app.tsx` 或它导入的 route/page modules 中
- `pages` 用于 standalone page outputs，`app` 用于 SPA declaration boundary
