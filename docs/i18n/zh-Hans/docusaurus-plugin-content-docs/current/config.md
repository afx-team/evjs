# 配置

evjs 默认零配置。多数应用只需要添加 `ev.config.ts` 来选择 SPA/MPA 路由、
自定义服务端文件路由，或调整部署相关路径。

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

## 默认值与适用范围

| 配置 | 默认值 / 行为 |
| --- | --- |
| `html` | 显式 app 或约定式页面路由共用的模板默认是 `./index.html`。MPA route 也可以使用就近的 `.html` 模板。 |
| `dev.port` | `3000` |
| `dev.https` | `false` |
| `server.dev.port` | `3001` |
| `server.dev.https` | `false` |
| `server.basePath` | `/__evjs` |
| `routing.mode` | `spa` |
| `routing.dir` | 启用 `routing` 时为 `./src/pages` |
| `routing.mount` | `#app` |
| `server.routing` | `true`；默认扫描 `./src/apis`，没有路由模块时自动退出 |
| `server.routing.dir` | `./src/apis` |
| `output.client` | `dist/client` |
| `output.server` | `dist/server` |
| `output.crossOriginLoading` | `"anonymous"` |

服务端函数、PPR 和 RSC 的运行时路径都从 `server.basePath` 派生。没有单独公开的
`server.functions` 或函数端点配置。

没有根级 `entry` 配置。约定式文件路由会在内部生成页面应用入口；手动自举 SPA 使用
`app.entry`。

## 常用配置

使用 `src/pages` 的约定式 SPA 可以保持最小配置：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

MPA 输出复用同一套 `src/pages` 文件，只需要切换模式：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

`src/apis` 下的服务端文件路由默认会被发现。只有需要更换路由目录时，才配置
`server.routing.dir`。

只写需要修改的字段：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  dev: {
    port: 4000,
  },
  server: {
    dev: {
      port: 4001,
    },
  },
});
```

## 路由

`routing` 负责从 `src/pages` 发现客户端页面：

```ts
export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },
});
```

当项目存在 `src/pages`，且没有声明显式 `app` 或 `pages` 配置时，SPA 路由会自动启用。

SPA routing 模式下，浏览器入口会从已发现的页面树生成。只有应用明确要用手写 SPA
bootstrap 代替文件路由时，才使用 `app.entry`。

SPA 根布局会在路由目录旁边自动查找 `layout/index.tsx`，例如 `src/pages` 对应
`src/layout/index.tsx`。只有应用 shell 明确放在其他位置时，才使用
`routing.conventions.layout`：

```ts
export default defineConfig({
  routing: {
    conventions: {
      layout: "./src/shell/AppLayout.tsx",
    },
  },
});
```

Layout 约定只用于 SPA；MPA 页面应组合普通 React 组件或复用 HTML 模板。

MPA 文件路由可以使用 colocated HTML 模板。例如 `src/pages/about.tsx` 使用
`src/pages/about.html`，`src/pages/product/index.tsx` 使用
`src/pages/product/index.html`。没有 colocated 模板的路由会使用顶层 `html` 模板，
除非配置了 `routing.html`。

## 页面

普通文件路由 SPA/MPA 优先使用 `routing`。只有输出无法用 `src/pages` 目录形状表达时，
才使用 `pages`。

字符串和 `{ component }` 都表示 evjs 托管的 React 页面：

```ts
export default defineConfig({
  pages: {
    home: "./src/pages/Home.tsx",
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/dashboard/Page.tsx",
      html: "./src/pages/public.html",
      mount: "#app",
    },
  },
});
```

只有页面需要自己控制浏览器 bootstrap 时，才使用 `{ entry }`：

```ts
export default defineConfig({
  pages: {
    landing: {
      entry: "./src/landing/main.tsx",
      html: "./src/landing/index.html",
    },
  },
});
```

Component page 对象可以直接声明渲染元信息：

```ts
export default defineConfig({
  pages: {
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
      render: "ssr",
      hydrate: "load",
    },
  },
});
```

同样的元信息也可以写成组件模块里的字面量导出：

```tsx
export const render = "ssr";
export const hydrate = "load";

export default function CampaignPage() {
  return <main>Campaign</main>;
}
```

Hydration mode 决定客户端交互开始的时机：`load` 立即激活，`visible` 等待挂载点进入
视口，`idle` 等待浏览器 idle callback，`none` 则让服务端或静态 HTML 保持无交互。
浏览器缺少对应调度 API 时会回退到 `load`。

## 显式 App

只有手动自举 SPA 时才使用 `app.entry`：

```ts
export default defineConfig({
  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
  },
});
```

## 服务端

`server.basePath` 控制服务端运行时边界。除非部署平台要求固定路径，否则保持默认值：

```ts
export default defineConfig({
  server: {
    basePath: "/__evjs",
  },
});
```

服务端文件路由默认启用并扫描 `./src/apis`。对象形式目前支持 `dir`；没有
`prefix` 选项。如果 URL 需要以 `/api` 开头，请把文件放到 `src/apis/api`
这样的目录中。

服务端文件路由发现启用时，服务端中间件约定默认启用：

- `src/middleware.ts`：全局服务端中间件。
- `src/apis/**/middleware.ts`：只作用于后代服务端文件路由的 API 路由中间件。

启用 React Server Components 支持：

```ts
export default defineConfig({
  server: {
    rsc: true,
  },
});
```

## 开发服务器

浏览器开发服务器默认使用端口 `3000`；服务端开发运行时默认使用端口 `3001`：

```ts
export default defineConfig({
  dev: {
    port: 4000,
  },
  server: {
    dev: {
      port: 4001,
    },
  },
});
```

`dev.https` 和 `server.dev.https` 可设置为 `false`、`true`，或包含 `key` 和 `cert`
的对象。

使用 `dev.proxy` 代理自己的后端服务：

```ts
export default defineConfig({
  dev: {
    proxy: [
      {
        context: ["/api"],
        target: "http://localhost:8080",
        pathRewrite: { "^/api": "" },
        changeOrigin: true,
      },
    ],
  },
});
```

## 输出

默认情况下，evjs 把浏览器资源写入 `dist/client`，服务端产物写入 `dist/server`。
部署平台需要其他目录结构时再修改：

```ts
export default defineConfig({
  output: {
    client: "dist",
    server: "dist-server",
  },
});
```

`output.crossOriginLoading` 控制 evjs 为生成的 JavaScript 和 CSS 标签添加的
`crossorigin` 属性。可选值是 `false`、`"anonymous"` 或 `"use-credentials"`。

## 传输

同源应用不需要配置 transport。只有浏览器需要访问另一个 origin 上的服务端运行时时，
才设置 `transport.baseUrl`：

```ts
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

## 插件

通过 `plugins` 注册框架插件：

```ts
export default defineConfig({
  plugins: [
    {
      name: "build-timer",
      setup() {
        const start = Date.now();
        return {
          buildEnd() {
            console.log("Build finished", Date.now() - start);
          },
        };
      },
    },
  ],
});
```

更多 hook 签名、单 HTML 文档上下文和 bundler 辅助函数见 [插件指南](./plugins)。

## Bundler

Utoopack 是默认 bundler。只有确实要切换时，才显式传入 bundler adapter：

```ts
import { defineConfig } from "@evjs/ev";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

export default defineConfig({
  bundler: utoopackAdapter,
});
```

## 不支持的旧字段

这些字段不是公开配置：

- `server.entry`
- `server.functions`
- `server.functionRuntime`
- `routing.routes`
- `routing.entry`
- 顶层 `functions` 或 `serverFunctions`

用 `server.routing.dir` 自定义服务端文件路由目录，服务端函数使用 `"use server"`
模块，服务端运行时路径使用 `server.basePath`，显式页面输出使用 `pages`。
