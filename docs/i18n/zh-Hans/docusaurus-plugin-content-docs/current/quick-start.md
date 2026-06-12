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
│   ├── pages/              # 文件路由
│   │   ├── __root.tsx      # 根布局
│   │   ├── index.tsx       # /
│   │   └── users/$id.tsx   # /users/$id
│   └── api/                # 服务端模块
│       ├── users.server.ts # "use server" 函数
│       └── health.routes.ts
├── package.json
└── tsconfig.json
```

## 文件路由

```tsx
// src/pages/users/$id.tsx
import { useFileRouteParams, useQuery } from "@evjs/client";
import { getUser } from "../../api/users.server";

export default function UserPage() {
  const { id } = useFileRouteParams();
  const { data } = useQuery(getUser, id);
  return <main>{data?.name}</main>;
}
```

当项目存在 `src/pages` 且没有 `src/main.tsx` 时，evjs 会自动基于文件树构建一个
TanStack Router 驱动的 SPA。用户不需要创建 route object、route tree 或全局 router 注册。

## MPA 模式

MPA 使用同一套 `src/pages` 文件，只需要切换文件路由模式：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  fileRoutes: {
    mode: "mpa",
  },
});
```

每个页面都会生成独立 HTML 文档和客户端 entry，不引入 TanStack Router。

## 包列表

| 包 | 用途 |
|---|------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | 框架 API、配置、插件和构建编排 (`defineConfig`, `dev`, `build`) |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | 注入默认构建器的轻量 CLI 包装 (`ev dev`, `ev build`) |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | 项目脚手架 (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | 浏览器运行时、transport、page runtime、shell 导出和页面工具 |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | Hono/fetch 服务端运行时、服务端函数、路由和 SSR/PPR/RSC 请求处理 |

Manifest schema、build tools、page runtime 和 shell 内部实现都位于上述公开包中。
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
- 优先使用 `src/pages` 作为路由事实来源
- 独立页面且不需要客户端路由器时，使用 `fileRoutes.mode: "mpa"`
