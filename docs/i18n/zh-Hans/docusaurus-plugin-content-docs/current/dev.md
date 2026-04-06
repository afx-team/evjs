# 开发服务器

## 命令

```bash
ev dev
```

无需参数 —— 配置来自 `ev.config.ts` 或基于约定的默认值。

## 工作原理

`ev dev` 会同时启动**两个服务器**：

| 服务器 | 默认端口 | 用途 |
|--------|---------|------|
| **Webpack Dev Server** | `3000` | 带热模块替换（HMR）的客户端 bundle |
| **API 服务器** | `3001` | 服务端函数 + 路由处理器 |

客户端开发服务器会自动将 `/api/*` 请求代理到 API 服务器。

```mermaid
flowchart LR
    Browser["浏览器"] -->|":3000"| WDS["Webpack Dev Server"]
    WDS -->|"HMR"| Browser
    WDS -->|"/api/* 代理"| API["API 服务器 :3001"]
    API --> Hono["Hono 应用"]
    Hono --> Registry["服务端函数注册表"]
```

## 编程式 API

```ts
import { dev, build } from "@evjs/ev";

// 启动开发服务器（加载 ev.config.ts 并应用默认值）
await dev({ dev: { port: 3000 } }, { cwd: "./my-app" });

// 运行生产构建
await build({ entry: "./src/app.tsx" }, { cwd: "./my-app" });
```
