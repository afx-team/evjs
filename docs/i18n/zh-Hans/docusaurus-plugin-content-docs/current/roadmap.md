# 实现状态

发布历史保存在仓库 `CHANGELOG.md`。本页只记录当前实现实际强制执行的架构边界。

## 框架核心

- `routing.mode`、`src/pages/**/page.*` 与相邻 `page.config.ts` 会为 SPA
  和 MPA 规范化成同一份 Application/Page/Route/Document CoreGraph。
- `application.routes` 是进入同一 graph 的显式 SPA-only 输入。
- `src/apis/**/api.*` 提供 request Route 和文件系统作用域的
  middleware。
- `BuildPlan` 驱动 generated `.ev` entry、bundler adapter、开发路由、输出
  ownership 与部署链接。
- `BuildOutput` 只保留在内存；`dist/deployment-metadata.json` 是规范化的序列化
  deployment projection。
- 插件可以拥有 namespaced Application、Page、Route 与 Document 数据，并挂载
  generated entry、wrapper、middleware、HTML、alias 与 external contribution。
- 内置 Node、static 与 edge deployment adapter 消费链接后的输出模型。

## Bundler 能力

| 能力 | Utoopack | Webpack |
| --- | --- | --- |
| Client build | 支持 | 支持 |
| Server rendering build | 不支持 | 支持 |
| RSC build | 不支持 | 支持 |
| PPR build | 不支持 | 支持 |
| Generated/HTML-only dev plan update | 支持 | 支持 |
| Entry/Route/server/resolution dev plan update | 需要重启 | 需要重启 |

Framework preflight 从选中的 adapter 读取这些声明；当 BuildPlan 需要未支持的构建
能力时，会在调用 bundler 前失败。

## Adapter 待补能力

- Utoopack 用于 server rendering、PPR 与 RSC 的 build fact 和 entry API。
- Entry、Route、server topology、module resolution 与 bundler config 的进程内
  structural dev-plan update。

已完成工作记录到 changelog；本页应始终与 adapter capability declaration 和聚焦
测试保持一致。
