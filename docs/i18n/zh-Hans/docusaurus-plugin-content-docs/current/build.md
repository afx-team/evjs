# 构建

## 命令

```bash
ev build
```

`ev build` 会读取 `ev.config.ts`，发现已配置的页面和服务端约定，运行当前 bundler，
并写入生产产物。

如果只想在不写入 `dist` 的情况下做一次预检查，可以使用：

```bash
ev inspect
ev inspect --json
```

`ev inspect` 会报告解析后的 routing mode、发现到的页面路由、服务端函数、服务端路由、
渲染元信息、生成路由类型的位置和诊断信息。存在 error 时命令会以非 0 状态退出。

## 输出

默认情况下，evjs 会把浏览器公开文件和服务端文件分开输出：

```txt
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   ├── [chunk].[hash].js
│   └── manifest.json
├── server/
│   ├── main.[hash].js
│   └── manifest.json
└── build-output.json
```

如果部署平台要求 public 文件在其他目录，可以配置 `output.client` 和
`output.server`：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  output: {
    client: "dist",
    server: "dist-server",
  },
});
```

这样浏览器资源会直接写入 `dist`，服务端产物写入 `dist-server`：

```txt
dist/
├── index.html
├── main.[hash].js
├── [chunk].[hash].js
└── manifest.json
dist-server/
├── main.[hash].js
└── manifest.json
```

生成的 HTML 会内嵌浏览器启动所需的 `ClientRuntime`。`client/manifest.json` 是轻量部署
元信息：SPA manifest 保留顶层公开 assets，MPA manifest 把 assets 保留在每个 routing
page 上。`server/manifest.json` 保留 server entry 文件名和 server route projection。
Runtime-only 的 `FrameworkRuntime` 数据会注入 dev 和 deployment bootstrap，不再作为
JSON 文件输出。`build-output.json` 是 canonical deployment metadata。应用代码不应该导入或
修改部署元信息文件。

## 页面输出

`routing.mode` 决定 `src/pages` 下页面文件的输出方式：

| 模式 | 输出 |
| --- | --- |
| `spa` | 为发现到的页面树输出一个浏览器 app shell。 |
| `mpa` | 为每个发现到的 CSR 页面输出独立 HTML 文档和客户端入口。 |

页面模块可以通过字面量导出声明服务端渲染或静态渲染：

```tsx
export const render = "ssr";
export const hydrate = "load";

export default function ProductPage() {
  return <main>Product</main>;
}
```

构建期静态生成使用 `render = "ssg"`，并要求页面拥有静态可寻址路径。`ev build`
会把该页面渲染成输出 HTML，例如 `dist/client/report.html`，部署元信息中表现为
`static-page` route。服务端页面的 partial prerendering 使用 `render = "ssr"`
加 `prerender = { partial: true }`。

```tsx
import { Suspense } from "react";

export const render = "ssr";
export const hydrate = "none";
export const prerender = { partial: true } as const;

export default function CampaignPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <CampaignContent />
    </Suspense>
  );
}
```

Partial prerendering 仍是实验能力。把 React `Suspense` 和 `prerender` 导出当作公开编写
API，不要依赖生成的内部 region id 或 manifest 细节。

RSC 页面使用 SSR 加 `rsc = true`，并需要开启 `server.rsc`：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: {
    rsc: true,
  },
});
```

```tsx
export const render = "ssr";
export const rsc = true;
export const hydrate = "none";

export default function InsightsPage() {
  return <main>Insights</main>;
}
```

RSC 页面暂不能同时使用 partial prerendering。当前请把这些能力拆到不同路由中。

## 服务端函数和路由

带 `"use server";` 的文件会在被 app、页面、服务端路由或中间件代码导入时进入构建。
构建后它们可以通过服务端运行时从浏览器调用。

启用 `server.routing` 后，服务端文件路由会从 `src/apis` 发现：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: {
    routing: true,
  },
});
```

```ts
// src/apis/api/health.ts
export const GET = async () => Response.json({ ok: true });
```

## 构建检查

构建失败时，先检查这些用户可控输入：

- `ev.config.ts` 导出 `defineConfig(...)`，且只使用公开配置字段。
- HTML 模板包含配置的挂载点，通常是 `<div id="app"></div>`。
- `src/pages` 路由符合文件约定：`$param` 动态段、`index.*` 目录根路由、
  小写 URL-safe 静态段。
- 页面模块默认导出 React 组件。
- 页面渲染元信息使用字面量值。
- `"use server"` 模块以指令开头，并导出命名函数。
- `src/apis` 路由模块导出大写 HTTP method，例如 `GET` 或 `POST`。

## 要点

- `ev build` 是生产构建命令。
- 需要诊断但不写产物时使用 `ev inspect`。
- 默认会拆分浏览器文件和服务端文件。
- 用 `output.client` / `output.server` 适配部署平台目录结构。
- 应用代码不要导入生成的 manifest 文件。
