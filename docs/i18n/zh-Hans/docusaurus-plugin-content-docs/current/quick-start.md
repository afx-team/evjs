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
| `with-tailwind` | 通过插件加载器使用 Tailwind CSS |
| `with-trpc` | tRPC 互操作示例 |
| `with-sqlite` | 基于 SQLite 的全栈 CRUD |
| `custom-ws-transport` | 自定义 WebSocket 传输层 |
| `plugin-authoring` | 插件生命周期与构建器钩子示例 |

## 开发

```bash
ev dev
```

浏览器将自动打开 `http://localhost:3000`，支持热模块替换。`*.server.ts` 文件中的服务端函数会被自动发现 —— 无需配置。

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
│   ├── global.ts           # 全局类型声明和传输初始化
│   ├── pages/              # 路由模块（以代码定义 TanStack Router 路由树）
│   │   ├── __root.tsx      # 根布局
│   │   └── home.tsx        # 首页（索引路由）
│   └── api/                # 服务端函数文件
│       └── *.server.ts
├── package.json
└── tsconfig.json
```

## 应用启动代码

```tsx
// src/main.tsx
import { createApp } from "@evjs/client";
import { rootRoute } from "./pages/__root";
import { homeRoute } from "./pages/home";
import "./global";

const routeTree = rootRoute.addChildren([homeRoute]);
const app = createApp({ routeTree });
app.render("#app");
```

```ts
// src/global.ts
import { initTransport } from "@evjs/client";

declare module "@tanstack/react-router" {
  interface Register {
    router: any;
  }
}
```

## 包列表

| 包 | 用途 |
|---|------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | 框架 API、配置、插件和构建编排 (`defineConfig`, `dev`, `build`) |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | 注入默认构建器的轻量 CLI 包装 (`ev dev`, `ev build`) |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | 项目脚手架 (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | 客户端运行时（React + TanStack） |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | 服务端运行时（Hono） |
| [`@evjs/build-tools`](https://github.com/evaijs/evjs/tree/main/packages/build-tools) | 服务端函数转换 |
| [`@evjs/bundler-utoopack`](https://github.com/evaijs/evjs/tree/main/packages/bundler-utoopack) | Utoopack 适配器 |
| [`@evjs/manifest`](https://github.com/evaijs/evjs/tree/main/packages/manifest) | 共享 Manifest Schema |

## 必需依赖

```json
{
  "dependencies": {
    "@evjs/client": "0.0.0",
    "@evjs/server": "0.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@evjs/ev": "*",
    "@evjs/cli": "*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^6.0.2"
  }
}
```

## 重要规则

- 配置文件：`ev.config.ts`（不是 `evjs.config.ts`）
- 从 `@evjs/ev` 导入 `defineConfig`，不是从 `@evjs/server`
- HTML 必须包含 `<div id="app">` 作为渲染目标
- 不要在你的**项目** `package.json` 中添加 `"type": "module"` —— 服务端 bundle 使用 CJS 格式
- `src/main.tsx` 应保持精简 —— 在 `pages/` 中定义路由
