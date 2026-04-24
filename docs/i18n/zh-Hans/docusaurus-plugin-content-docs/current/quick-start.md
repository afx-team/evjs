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
| `basic-csr` | 仅客户端渲染，无服务端函数 |
| `basic-server-fns` | 最小化的 `"use server"` 服务端函数 |
| `configured-server-fns` | 带 `ev.config.ts` + Query 代理的服务端函数 |
| `complex-routing` | 参数、搜索、布局、加载器、嵌套路由 |
| `with-tailwind` | 通过插件加载器使用 Tailwind CSS |

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
│   ├── pages/              # 路由页面（基于文件的路由）
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
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | CLI 命令行工具 (`ev dev`, `ev build`) |
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | 配置、插件和构建器类型 (`defineConfig`) |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | 项目脚手架 (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | 客户端运行时（React + TanStack） |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | 服务端运行时（Hono） |
| [`@evjs/build-tools`](https://github.com/evaijs/evjs/tree/main/packages/build-tools) | 服务端函数转换 |
| [`@evjs/bundler-utoopack`](https://github.com/evaijs/evjs/tree/main/packages/bundler-webpack) | Webpack 适配器 |
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
