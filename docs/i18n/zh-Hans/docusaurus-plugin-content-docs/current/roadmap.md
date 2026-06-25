# 路线图

## 已完成基础

- 零配置 React 应用构建，支持 `ev dev` 和 `ev build`。
- 通过 `src/pages` 支持页面路由 SPA discovery。
- 通过 `routing.mode: "mpa"` 支持页面路由 MPA 输出。
- 通过 `pages` 支持显式多页面输出。
- 从 `"use server"` 模块提取服务端函数。
- Hono/fetch 服务端 runtime 和显式服务端路由。
- 覆盖 config、bundler、output、HTML、build 阶段的插件系统。
- 基于 `BuildPlan` 和 `BuildOutput` 的 bundler adapter contract。
- 程序化 `prepareFrameworkBuild()` API，可在不启动 bundler 或平台 adapter
  的情况下完成框架 preflight，且不暴露内部 graph/plan 状态。
- `ev inspect` CLI preflight，可在不运行 bundler、不写入 `dist` 的情况下解释
  page route discovery、server declarations、render metadata、runtime paths、
  planned entries 和 diagnostics。
- 通过 `output.client` 和 `output.server` 配置 framework manifest 目录，并保留完整私有
  `dist/build-output.json` handoff。
- 通过公开 `@evjs/client` runtime 包提供 manifest-driven app/page activation。
- 框架托管 SPA 页面路由，并为 MPA 提供无路由器 page runtime。
- Webpack adapter 用于在 Utoopack 下层 API 补齐前验证框架能力。
- 聚焦 render mode 和 deployment adapter 的示例，并通过 e2e 覆盖 apps、组件页面、SSR/PPR/RSC 和 per-document HTML transform。
- Public manifest redaction，确保浏览器可见输出不暴露本地源码路径。
- 内置 Node、static、edge deployment adapter artifacts。
- 统一 server request context 和 middleware 语义，覆盖 server functions、
  server routes、SSR、PPR、RSC。
- PPR page response 会根据 region 策略为 merged、streamed 和 HEAD response
  派生 cache headers。
- PPR region runtime cache hardening，支持 pluggable cache provider、
  stale-while-revalidate header，以及面向 edge/origin 拆分部署的后台 stale refresh。
- RSC Flight response 默认使用 `Cache-Control: no-store`，并保留 renderer
  显式 cache headers。

## 进行中

- Utoopack parity 优先级 1：dynamic entry/server dev plan update，用于不重启
  `ev dev` 增删 entry。
- Utoopack parity 优先级 2：framework-managed component pages 所需的
  generic entry wrapping/loadable entry facts。
- Utoopack parity 优先级 3：SSR/PPR/RSC renderers 的 multi server build-entry facts。
- Utoopack parity 优先级 4：RSC client/server reference metadata。

## 计划中

- 页面路由类型能力继续收敛：在不暴露 router internals 的前提下保留更完整的 params/search/loader data 类型。
- 更生产级的 PPR 行为，包括显式 client islands 和更深入的 React streaming renderer 集成。
- Utoopack 下层能力补齐：dynamic entries、structured build result、多 server build-entry class、RSC/client reference metadata。
