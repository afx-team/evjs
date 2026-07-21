# 开发服务器

## 命令

```bash
ev dev
```

无需参数。配置来自 `ev.config.ts` 或基于约定的默认值。

## 启动内容

`ev dev` 会启动面向浏览器的开发服务器；当应用使用服务端能力时，还会启动服务端开发运行时：

| 服务器 | 默认端口 | 用途 |
| --- | --- | --- |
| **客户端开发服务器** | `3000` | 浏览器 bundle、HTML 和模块热替换（HMR）。 |
| **服务端开发运行时** | `3001` | 服务端函数、服务端文件路由、SSR、PPR 和 RSC 请求。 |

每个 `ev dev` 会把客户端和服务端端口作为一组统一预留。如果首选端口已被占用，evjs
会选择下一组可用端口，并在启动前打印映射关系。监听器、SPA history fallback、服务端代理
和就绪日志都会使用解析后的同一组端口。如果 Utoopack 在启动过程中还必须再次调整客户端端口，
evjs 会在输出就绪日志前把 SPA fallback 同步到实际监听地址，因此路由请求不会再落到仍监听
原配置端口的其他应用。

同一个项目目录同一时间只允许一个 dev session。对同一应用重复启动 `ev dev` 时，命令会立即退出
并显示已有进程 ID，避免两个进程同时覆盖 `.ev` 和 `dist`。不同项目目录可以并行启动，evjs
会在进程间协调端口预留。

客户端和 API 开发服务器会监听 IPv4 地址，可以同时通过 `http://localhost:<port>` 和
`http://127.0.0.1:<port>` 访问。启动日志遵循 Bigfish 的格式，显示 `Local` localhost URL
和本机的 `Network` URL；等价的 `127.0.0.1` URL 仍然可用，但不会额外打印。`localhost`
和 `127.0.0.1` 属于不同的浏览器 origin，因此不会共享 cookie、local storage 和 service
worker。使用自定义 HTTPS 证书且需要同时访问两个地址时，证书的 subject alternative names
必须包含这两个地址。

客户端开发服务器会把服务端运行时路径代理到服务端开发运行时。默认情况下这些路径来自
`server.basePath`，包括 `/__evjs/fn`、`/__evjs/ppr` 和 `/__evjs/rsc`。

SPA history fallback 不会接管 `/api` 或派生出的服务端运行时路径。因此拼错的服务端请求会返回
服务端/代理 404，而不是应用 HTML。

```mermaid
flowchart TB
  Browser["浏览器"]

  subgraph ClientSide["客户端开发服务器 :3000"]
    HTML["HTML + browser bundle"]
    HMR["HMR websocket"]
    Proxy["/__evjs/* 代理"]
  end

  subgraph ServerSide["服务端开发运行时 :3001"]
    Functions["服务端函数"]
    Routes["服务端路由"]
    Rendering["SSR / PPR / RSC"]
  end

  subgraph Updates["Framework updates"]
    Files["src/pages\nsrc/apis\nev.config.ts"]
    Plan["refresh AppGraph\nand .ev plan"]
  end

  Browser --> HTML
  HMR --> Browser
  Browser --> Proxy --> ServerSide
  ServerSide --> Functions
  ServerSide --> Routes
  ServerSide --> Rendering
  Files --> Plan
  Plan --> ClientSide
  Plan --> ServerSide

  classDef browser fill:#fff7ed,stroke:#fb923c,color:#7c2d12;
  classDef client fill:#eef6ff,stroke:#8fb5e8,color:#102a43;
  classDef server fill:#ecfdf5,stroke:#34d399,color:#064e3b;
  classDef update fill:#f3f0ff,stroke:#a78bfa,color:#2e1065;
  class Browser browser;
  class HTML,HMR,Proxy client;
  class Functions,Routes,Rendering server;
  class Files,Plan update;
```

## 配置

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  dev: {
    port: 3000,                   // 客户端开发服务器端口
    https: false,                 // 客户端开发服务器 HTTPS
  },
  server: {
    basePath: "/__evjs",          // 服务端运行时路径从这里派生
    dev: {
      port: 3001,                 // 服务端开发运行时端口
      https: false,               // 服务端开发运行时 HTTPS
    },
  },
});
```

约定式 `src/pages` 应用不需要配置 `entry`。发现页面路由后，
开发服务器会使用生成的页面应用入口。

`dev.port` 和 `server.dev.port` 是首选端口，必须是 `1` 到 `65535` 之间的 TCP
端口整数。如果端口不可用，当前 dev session 会使用附近的可用端口并输出变更信息。
自定义 `dev.proxy` 规则必须提供非空 `context` pathname pattern 数组，以及 absolute
HTTP(S) URL `target`。Context pattern 必须以 `/` 开头，不能包含空白字符、query string
或 hash，并且同一条规则内不能重复。Target 不能包含首尾空白字符。使用
`pathRewrite` 可以在转发到 target 前改写被代理的请求路径。

自定义代理规则会先于服务端运行时路径的内置代理应用，因此应用自己的 API proxy 可以保留独立的路由行为。

## 请求流

1. 客户端开发服务器提供浏览器代码和 HMR。
2. 服务端函数、服务端文件路由、SSR、PPR 和 RSC 请求会进入服务端开发运行时。
3. 从 `server.basePath` 派生的路径会自动代理。
4. 文件变化时会触发浏览器和服务端重建；修改配置化 entry 或路由根目录后需要重启 `ev dev`。

## 编程式 API

`ev dev` 和 `ev build` 也可以在代码中编程式调用：

```ts
import { dev, build } from "@evjs/cli";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

// 使用显式构建器适配器启动开发服务器
await dev({ dev: { port: 3000 } }, { cwd: "./my-app", bundler: utoopackAdapter });

// 为约定式页面路由运行生产构建
await build({ routing: { mode: "spa" } }, { cwd: "./my-app", bundler: utoopackAdapter });
```

`bundler` option 和 `ev.config.ts` 中的 adapter 契约一致：必须是 object，且包含非空
`name` 以及 `build` / `dev` 函数。

`@evjs/cli` 也导出兼容包装函数，会自动注入默认的 Utoopack 适配器，与 `ev dev`
和 `ev build` 命令保持一致。

## 传输层

默认 HTTP 传输不需要应用代码配置。只有在需要定制内置 HTTP 适配器，或替换为自定义适配器时，
才需要在应用启动时调用 `initTransport()`。

- 在**开发模式**中，客户端开发服务器会把 `/__evjs/fn`、`/__evjs/ppr`、
  `/__evjs/rsc` 等服务端运行时路径代理到服务端开发运行时。
- 在**生产模式**中，客户端和服务端通常在同一个源下。
- 当浏览器发起的服务端函数请求需要访问另一个 origin 时，使用 `transport.baseUrl`。
- 内置 HTTP 适配器通过 `credentials` 和 `headers` 配置；fetch `mode` 不提供配置。
