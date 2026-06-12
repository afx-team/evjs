# 项目目录结构

evjs 应用默认以页面路由作为客户端边界。文档和新应用统一使用一份完整推荐结构；实际项目不需要的目录可以直接删除。

## 推荐结构

```text
my-evjs-app/
├── ev.config.ts                 # 框架配置
├── index.html                   # 共享 HTML 模板，包含 <div id="app">
├── package.json
├── public/                      # 原样复制的静态文件
├── tsconfig.json
└── src/
    ├── server.ts                # framework/server entry
    ├── styles.css               # 全局 CSS / Tailwind 入口
    ├── layout.tsx               # 可选 SPA 根布局
    ├── pages/                   # 页面路由
    │   ├── index.tsx            # /
    │   ├── dashboard.tsx        # /dashboard
    │   ├── campaign.tsx         # /campaign
    │   ├── insights.tsx         # /insights
    │   └── users/$userId.tsx    # /users/$userId
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

- `ev.config.ts` 只在默认值不够时自定义 routing 模式、服务端路径、远程应用、插件或显式页面输出。
- `pages/` 是客户端路由事实来源。SPA 模式会映射到框架托管的 app entry；MPA 模式会映射到独立页面 entry。
- `layout.tsx` 只作为可选 SPA 根布局。MPA 页面需要公共外框时，应直接导入普通共享组件。
- 渲染元信息放在页面模块旁边。
- `api/*.server.ts` 放 server functions。
- `api/*.routes.ts` 放标准 HTTP route handlers。
- `server.ts` 组合 `@evjs/server` routes、middleware 和 framework rendering。
- `features/` 把业务逻辑从 route/page files 中移走。

## 对应配置

对应的 `ev.config.ts` 可以保持很小：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
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

当每个路由都应该输出独立 HTML 文档且不需要客户端路由器配置时，使用
`routing: { mode: "mpa" }`。只有页面输出无法自然映射到 `src/pages` 时，才使用更底层的
`pages` 配置。

## 页面模块

`src/pages` 下每个文件默认导出一个 React 组件。动态段使用 `$param`，
`index.tsx` 映射到当前目录根路径。`[id].tsx` 这类 bracket 路由段会被拒绝。
渲染元信息放在页面组件旁边：

```tsx
// src/pages/campaign.tsx
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

页面文件应保持轻量：读取 params/search，导出页面级 loader 或渲染元信息，并从
`features/` 或 `components/` 组合组件。业务逻辑放到领域模块中。

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

- `pages/` 是文件路由目录，也可以包含 SSR/PPR/RSC components。
- `api/` 是服务端边界。
- `features/` 放业务领域模块。
- `components/` 放通用 UI。
- `lib/` 放浏览器安全的共享工具。
- 服务端密钥和 Node-only API 应留在 `api/`，或只被 server-only code 引用的模块中。
