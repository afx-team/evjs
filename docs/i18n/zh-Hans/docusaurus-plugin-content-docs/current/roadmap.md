# 路线图

## 已完成基础

- 零配置 React 应用构建，支持 `ev dev` 和 `ev build`。
- 通过 `src/pages` 支持页面路由 SPA discovery。
- 通过 `routing.mode: "mpa"` 支持页面路由 MPA 输出。
- 通过 `pages` 支持显式多页面输出。
- 从 `"use server"` 模块提取服务端函数。
- Hono/fetch 服务端 runtime 和显式服务端路由。
- 覆盖 config、graph、plan、bundler、output、HTML、build 阶段的插件系统。
- 基于 `BuildPlan` 和 `BuildOutput` 的 bundler adapter contract。
- 程序化 `prepareFrameworkBuild()` API，可在不启动 bundler 或平台 adapter
  的情况下准备框架 graph/plan。
- 单一框架 manifest：`dist/manifest.json`。
- 通过公开 `@evjs/ev/client` facade 提供 manifest-driven app/page/remote activation。
- 框架托管 SPA 页面路由，并为 MPA 提供无路由器 page runtime。
- Webpack adapter 用于在 Utoopack 下层 API 补齐前验证框架能力。
- 完整 host/remote 示例，并通过 e2e 覆盖 apps、组件页面、SSR/PPR/RSC、
  remotes 和 per-document HTML transform。
- Public manifest redaction，确保浏览器可见输出不暴露本地源码路径。
- 内置 Node、static、edge deployment adapter artifacts。

## 进行中

- Utoopack dynamic entry/server dev plan update，用于不重启 `ev dev` 增删 entry。
- Utoopack 对多 server render entry 的 build facts 支持。
- Utoopack 运行 RSC 和 framework-managed render entry 所需的 reference metadata。
- 非根 public path、CDN/edge+origin 部署下的 RSC/PPR cache 行为生产级 hardening。

## 计划中

- 页面路由类型能力继续收敛：在不暴露 router internals 的前提下保留更完整的 params/search/loader data 类型。
- 统一 server request context 和 middleware 语义，覆盖 server functions、server routes、SSR、PPR、RSC。
- 更生产级的 PPR 行为，例如 stale revalidation strategy、pluggable region cache、显式 client islands 和更深入的 React streaming renderer 集成。
- Utoopack 下层能力补齐：dynamic entries、structured build result、多 server entry class、RSC/client reference metadata。
