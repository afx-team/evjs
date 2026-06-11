# 项目目录结构

evjs 不要求文件路由，也不需要很重的脚手架。文档和新应用统一使用一份完整推荐结构；实际项目不需要的目录可以直接删除。

## 推荐结构

```text
my-evjs-app/
├── ev.config.ts                 # 框架配置
├── index.html                   # 共享 HTML 模板，包含 <div id="app">
├── package.json
├── public/                      # 原样复制的静态文件
├── tsconfig.json
└── src/
    ├── app.tsx                  # 主应用声明和客户端入口
    ├── routes/
    │   ├── operations.ts        # operations route group
    │   └── engagement.ts        # engagement route group
    ├── server.ts                # framework/server entry
    ├── styles.css               # 全局 CSS / Tailwind 入口
    ├── pages/                   # route/page components
    │   ├── Dashboard.tsx        # SSR route/page component
    │   ├── Campaign.tsx         # PPR route/page shell
    │   ├── OfferRegion.tsx      # Suspense-driven PPR region
    │   ├── Insights.tsx         # RSC route/page component
    │   ├── Support.tsx          # CSR standalone page
    │   └── RemoteApp.tsx        # remote host page
    ├── api/
    │   ├── operators.server.ts  # "use server" functions
    │   └── health.routes.ts     # Request/Response route handlers
    ├── components/              # 可复用 UI
    ├── features/                # 业务领域模块
    │   └── operations/
    │       ├── components/
    │       ├── hooks/
    │       ├── model.ts
    │       └── types.ts
    ├── lib/                     # 浏览器安全的共享工具
    └── hooks/                   # 全局 React hooks
```

这棵目录覆盖完整框架能力：

- `ev.config.ts` 只把 SPA app 指向一个 app declaration source。
- `app.tsx` 拥有 app document、client entry、mount point 和 route groups。
- `routes/operations.ts` 这类 route group 负责 path-to-component wiring，并由 `app.tsx` 导入，不在配置里分别声明。
- `pages/` 放 app routes 或 standalone pages 使用的 React components，渲染元信息放在这些 page modules 旁边。
- `api/*.server.ts` 放 server functions。
- `api/*.routes.ts` 放标准 HTTP route handlers。
- `server.ts` 组合 `@evjs/server` routes、middleware 和 framework rendering。
- `features/` 把业务逻辑从 route/page files 中移走。

## 对应配置

对应的 `ev.config.ts` 保持应用边界显式：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  html: "./index.html",
  app: "./src/app.tsx",

  pages: {
    support: {
      path: "/support",
      component: "./src/pages/Support.tsx",
      mount: "#app",
    },
  },

  server: {
    entry: "./src/server.ts",
    rsc: true,
  },

  remotes: {
    crm: {
      manifest: "https://assets.example.com/crm/evjs-remote.json",
      activeWhen: ["/crm/*"],
    },
  },
});
```

`entry` / `html` 仍可作为单个简单应用的 shorthand。新应用一旦有 route declarations、framework-managed rendering 或非默认 mount point，就优先使用 `app`。`pages` 用于 standalone page outputs，不用于 `/dashboard`、`/campaign`、`/insights` 这类 app-owned routes。

## App Declaration

App declaration 可以基于 TanStack Router，也可以不依赖 TanStack。需要 framework-managed rendering 但不想使用 TanStack Router 时，使用 `defineReactApp()`：

```ts
// src/app.tsx
import { defineReactApp } from "@evjs/client";
import { engagementRoutes } from "./routes/engagement";
import { operationsRoutes } from "./routes/operations";
import "./styles.css";

function App() {
  return <main>Operations console</main>;
}

export default defineReactApp({
  html: "../index.html",
  mount: "#app",
  component: App,
  routes: [...operationsRoutes, ...engagementRoutes],
});
```

```ts
// src/routes/operations.ts
import { route } from "@evjs/client";
import Dashboard from "../pages/Dashboard";
import Insights from "../pages/Insights";

export const operationsRoutes = [
  route("/dashboard", Dashboard, {
    id: "dashboard",
  }),
  route("/insights", Insights, {
    id: "insights",
  }),
];
```

```ts
// src/routes/engagement.ts
import { route } from "@evjs/client";
import Campaign from "../pages/Campaign";

export const engagementRoutes = [
  route("/campaign", Campaign, {
    id: "campaign",
  }),
];
```

`defineReactApp()` 是 app 边界；提供 `component` 或 `render` 时，它同时也是浏览器入口。真正的 `route()` 调用放在按领域拆分的模块里，大应用可以按业务域拆 route group，但不需要把 app 配置拆散在 `ev.config.ts` 和 route files 之间。route target 是普通的静态 React import，因此 graph 仍可分析，也不需要用户写组件模块路径字符串。渲染元信息放在 page component 旁边：

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

如果应用确实需要生成的或独立的 runtime entry，可以在 declaration 里显式写 `entry: "./main.tsx"`。这是逃生口，不是默认 app model。

Route files 应保持轻量：读取 params/search、把路径连接到组件，并从 `features/` 或 `components/` 组合组件。渲染元信息放在 page component 旁边，业务逻辑放到领域模块中。

## 服务端边界

默认把服务端专用代码放在 `src/api/` 下。

```ts
// src/api/operators.server.ts
"use server";

export async function listOperators() {
  return [{ id: "ada", name: "Ada Lovelace" }];
}
```

```ts
// src/api/health.routes.ts
import { createRoute } from "@evjs/server";

export const healthRoute = createRoute("/api/health", {
  GET: async () => Response.json({ ok: true }),
});
```

在 `src/server.ts` 中挂载 routes 和 framework rendering：

```ts
import { createApp, requestLogger } from "@evjs/server";
import { createReactFrameworkServer } from "@evjs/server/react";
import { healthRoute } from "./api/health.routes";

const framework = createReactFrameworkServer();

const app = createApp({
  middlewares: [requestLogger()],
  routes: [healthRoute],
  framework,
});

export default { fetch: app.fetch };
```

## Remote Builds

Host 应用通过 `remotes` 消费远程应用。一个包如果自身要作为 remote app 输出，则在配置中声明 `remote`，并复用同样的 `src/` 组织方式：

```ts
export default defineConfig({
  remote: {
    name: "crm",
    baseUrl: "https://assets.example.com/crm/",
    entries: {
      default: {
        app: "./src/remote.tsx",
        activeWhen: ["/crm/*"],
      },
    },
  },
});
```

Remote module 可以默认导出 React component。只有高级场景才需要显式导出 `mount`、`hydrate`、`unmount` 生命周期。

## 命名建议

- `apps/` 可作为单个 app declaration 的源码目录，不代表配置层多 app 模型。
- `pages/` 放 route/page components，包括 SSR/PPR/RSC components。
- `api/` 是服务端边界。
- `features/` 放业务领域模块。
- `components/` 放通用 UI。
- `lib/` 放浏览器安全的共享工具。
- 服务端密钥和 Node-only API 应留在 `api/`，或只被 server-only code 引用的模块中。
