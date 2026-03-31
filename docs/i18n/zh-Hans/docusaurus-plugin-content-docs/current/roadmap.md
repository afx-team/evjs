# 路线图

## ✅ 阶段 1 —— 客户端优先的 SPA

基础：零配置的 React SPA，具有类型安全的路由和数据获取。

- `createApp({ routeTree })` —— 连接 Router + QueryClient + DOM 挂载
- 基于代码的路由（TanStack Router，嵌套布局，类型化加载器）
- 数据获取（TanStack Query，重新导出的 hooks）
- CLI：`npx @evjs/create-app`、`ev dev`、`ev build`

## ✅ 阶段 2 —— 服务端函数

从浏览器调用服务端逻辑，就像调用普通异步函数一样。

- 通过 SWC AST 解析检测 `"use server"` 指令
- 使用稳定 SHA-256 函数 ID 的客户端/服务端转换
- `query(fn).useQuery()` / `mutation(fn).useMutation()` —— 零模板封装
- 可插拔的 `ServerTransport` 接口
- 基于 Hono 的多运行时适配器服务器
- 版本化的 manifest schema（`manifest.json` v1）

## ✅ 阶段 3 —— 零配置全栈框架

- 零配置 `ev build` / `ev dev` —— 无需 `webpack.config.cjs`
- `ev.config.ts` + `defineConfig()` 可选自定义
- webpack Node API —— 无临时配置文件，无子进程

## ✅ 阶段 4 —— 插件系统和构建元数据

- 带 `name` + `config` + `bundler` 钩子的 `EvPlugin` 接口
- Manifest 客户端部分（`client.assets`、`client.routes`）
- `npx @evjs/create-app` 的模板符号链接

## 🔲 探索中

正在考虑的未来方向：

- **MPA** —— `client.pages` 字段，支持多入口构建
- **服务端上下文** —— 服务端函数的请求上下文（headers、cookies、auth）
- **SSR** —— 带水合的服务端渲染
- **RSC** —— 通过 Flight 协议实现 React Server Components
- **更多打包器** —— 通过 `@evjs/build-tools` 实现 Rspack、Vite 插件
