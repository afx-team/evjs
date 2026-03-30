# 架构

## 概述

evjs 是一个 React 全栈框架，具有类型安全路由（TanStack Router）、数据获取（TanStack Query）和服务端函数（`"use server"`）。它使用基于 Hono 的 API 服务器，并且设计为与打包器无关。

## 构建时架构

```
┌─────────────────────────── 构建时 ────────────────────────────┐
│                                                                │
│  @evjs/cli ──► @evjs/webpack-plugin ──► @evjs/manifest         │
│                      ▲                    (manifest.json)      │
│  @evjs/build-tools ──┘                                         │
│  (打包器无关)                                                    │
│                                                                │
└──────────────────────────────┬─────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌──────── 客户端 (浏览器) ─────────┐ ┌──────── 服务端 (Node/Edge) ──────┐
│                                 │ │                                   │
│  TanStack Router                │ │  Hono App (createApp)             │
│  TanStack Query                 │ │  registerServerFn() + route()     │
│  __fn_call() 桩代码              │ │  createHandler()                  │
│  ServerTransport ───────────────┼─┼──► POST /api/fn ──► registry     │
│                                 │ │                                   │
└─────────────────────────────────┘ └───────────────────────────────────┘
```

## 包依赖图

```
@evjs/cli ──► @evjs/webpack-plugin ──► @evjs/build-tools ──► @swc/core
    │
    └──► webpack (Node API)

@evjs/shared (独立包，无依赖)

@evjs/server ──► @evjs/shared, hono, @hono/node-server
@evjs/client ──► @evjs/shared, @tanstack/react-router, @tanstack/react-query
```

## 配置流程

```
ev.config.ts ──► defineConfig({ client, server })
                    │
                    ├── client.entry, client.html ──► webpack 入口 + HtmlPlugin
                    ├── client.plugins ──► EvPlugin[]（自定义模块规则）
                    ├── client.dev.port ──► WebpackDevServer 端口
                    ├── server.functions.endpoint ──► EvWebpackPlugin + 代理路径
                    ├── server.plugins ──► EvPlugin[]（服务端 bundle 模块规则）
                    ├── server.dev.port ──► API 服务器端口
                    └── server.dev.https ──► API 服务器 HTTPS
                    │
                    ▼
              createWebpackConfig() ──► webpack Node API
```

## 服务端函数管道

`"use server"` 指令在构建时触发两个独立的转换：

```
               ┌── 客户端构建 ──► import { __fn_call } from 'transport'
               │                  export function getUsers(...args) {
.server.ts ────┤                    return __fn_call(fnId, args)
               │                  }
               │
               └── 服务端构建 ──► import { registerServerFn } from 'server'
                                  // 原始函数体保留
                                  registerServerFn(fnId, getUsers)
```

## 开发服务器架构

```
浏览器 ──(:3000)──► WebpackDevServer ──► HMR（静态资源）
                          │
                          └── /api/* 代理 ──► Node 服务器 (:3001)
                                                    │
                                              Hono App
                                                    │
                                              POST /api/fn
                                                    │
                                              registry.get(fnId)(...args)
```

`ev dev` 直接使用 webpack Node API：
1. 在进程内创建 webpack compiler + WebpackDevServer
2. 轮询 `dist/manifest.json`
3. 写入 CJS 引导文件并使用 `node --watch` 运行

## 构建流程（`ev build`）

1. `loadConfig(cwd)` —— 加载 `ev.config.ts` 或使用默认值
2. `createWebpackConfig(config, cwd)` —— 生成 webpack 配置（无临时文件）
3. 直接调用 `webpack()` Node API
4. `@evjs/webpack-plugin` 在编译期间运行：
   - 通过 glob 发现 `*.server.ts` 文件
   - 应用 SWC 转换（客户端 + 服务端变体）
   - 运行子编译器生成服务端 bundle
   - 输出 `dist/manifest.json`（函数注册表 + 客户端资源）

## 部署适配器

```
Node.js          server.entry.mjs ──► @hono/node-server
ECMA (Deno/Bun)  server.entry.mjs ──► createFetchHandler(app)
Service Worker   sw.entry.js ──► self.addEventListener('fetch', ...)
```
