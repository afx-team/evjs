# 路线图

## 已完成基础

- 零配置 React 应用构建，支持 `ev dev` 和 `ev build`。
- canonical Page-and-Route 约定：Page directory 的正向 `page.*` 锚点、
  可选构建期 `page.config.ts`、目录派生 URL 与 SPA/MPA `routing.mode`。
- 从 `"use server"` 模块提取服务端函数。
- Hono/fetch 服务端 runtime 和显式服务端路由。
- 覆盖 config、bundler、output、HTML、build 阶段的插件系统。
- 基于 `BuildPlan` 和 `BuildOutput` 的 bundler adapter contract。
- 程序化 `prepareFrameworkBuild()` API，可在不启动 bundler 或平台 adapter
  的情况下完成框架 preflight，且不暴露内部 graph/plan 状态。
- `ev inspect` CLI preflight，可在不运行 bundler、不写入 `dist` 的情况下解释
  page route discovery、server declarations、render metadata、runtime paths、
  planned entries 和 diagnostics。
- 通过 `output.client` 和 `output.server` 配置 client/server 产物目录，并在
  `dist/deployment-metadata.json` 输出 canonical deployment metadata。
- 通过公开 `@evjs/client` runtime 包和生成的 framework bootstrap 提供
  ClientRuntime-driven Application/Page activation。
- 框架托管 SPA 页面路由，并为 MPA 提供无路由器 page runtime。
- Webpack adapter 用于在 Utoopack 下层 API 补齐前验证框架能力。
- 聚焦 render mode 和 deployment adapter 的示例，并通过 e2e 覆盖 apps、组件页面、SSR/PPR/RSC 和 per-document HTML transform。
- Public manifest redaction，确保浏览器可见输出不暴露本地源码路径。
- 内置 Node、static、edge deployment adapter artifacts。
- Page data hook 覆盖 params、search、loader data，同时不暴露 router internal。
- 统一 server request context 和 middleware 语义，覆盖 server functions、
  server routes、SSR、PPR、RSC。
- PPR page response 会根据 region 策略为 merged、streamed 和 HEAD response
  派生 cache headers。
- PPR region runtime cache hardening，支持 pluggable cache provider、
  stale-while-revalidate header，以及面向 edge/origin 拆分部署的后台 stale refresh。
- RSC Flight response 默认使用 `Cache-Control: no-store`，并保留 renderer
  显式 cache headers。

## 进行中

- [Core 0.3](./core-0.3-rfc) 现已把唯一 canonical
  `routing.mode + page.* + page.config.ts` 模型解析为 SPA/MPA 的 validated
  CoreGraph，输出 `.ev/framework/core-graph.json`，并诊断非法
  Page/Route/Document ownership 或 Page 配置。
- 继续加固 Bigfish 显式 route normalizer，以及 Smallfish/evjs 0.2 一次性源码
  迁移指南，不把存量模型提升为 runtime reader。
- canonical MPA 已从静态语义 Route 生成 Page-owned Document，并组合
  file-convention layout；动态 route 和 router-only boundary facet 会被明确拒绝。
- 插件 API 已落地按 dependency 排序、可安全 reload 的 `describe`，带 namespace
  的 Application/Page defaults/config/validation、严格 static serialization、
  resolved extension view，以及跨 runtime `page.wrapper` contribution。参见
  [0.2 迁移指南](./plugin-migration-0.2-to-0.3)。
- 继续实现插件 API 的 owned Route/Document schema、graph transform/selector、
  更多 semantic facet、typed runtime hook 与 generic extension entry。

## 计划中

- Bigfish route-normalizer 覆盖、Smallfish/evjs 0.2 源码 codemod、capability
  report 和代表性插件迁移。
- Generic extension entry、Document、request facet、manifest projection 就绪后，从 Core
  移除内建 SSR/PPR/RSC 分支。
- Utoopack 下层能力补齐：generic dynamic entry、structured build fact，以及
  extension-owned client/server/build environment。
