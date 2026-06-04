# 路线图

## 已完成基础

- 零配置 React 应用构建，支持 `ev dev` 和 `ev build`。
- 通过 `entry` / `html` 和 `apps` 显式声明应用入口。
- 通过 `pages` 支持多页面输出。
- 从 `"use server"` 模块提取服务端函数。
- Hono/fetch 服务端 runtime 和显式服务端路由。
- 覆盖 config、graph、plan、bundler、output、HTML、build 阶段的插件系统。
- 基于 `BuildPlan` 和 `BuildOutput` 的 bundler adapter contract。
- 单一框架 manifest：`dist/manifest.json`。
- 用于 app/page/remote activation 的 shell/runtime packages。
- TanStack adapter 从 shell/runtime core 中拆出。
- Webpack adapter 用于在 Utoopack 下层 API 补齐前验证框架能力。
- 完整 host/remote 示例，并通过 e2e 覆盖 apps、组件页面、SSR/PPR/RSC、
  remotes 和 per-document HTML transform。

## 进行中

- Utoopack dynamic dev plan update，用于不重启 `ev dev` 增删 entry。
- Utoopack 对 framework-managed component entry 和多 server render entry 的 build facts 支持。
- 生产部署插件迁移到消费 `BuildOutput`，不再读取 v1 client/server manifests。

## 计划中

- 完整 React Server Components transform/runtime adapter。
- RSC client/server reference manifests 和 Flight runtime integration。
- 更生产级的 PPR 行为，例如 streaming 和 stale revalidation strategy。
