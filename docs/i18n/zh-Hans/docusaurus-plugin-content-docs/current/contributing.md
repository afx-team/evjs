# 贡献指南

> evjs 单仓库的内部开发指南。

## 项目信息

- **名称**：evjs（全栈框架），`@evjs/*`（包范围）
- **仓库**：[evaijs/evjs](https://github.com/evaijs/evjs)
- **CLI 命令**：`ev`（来自 `@evjs/cli` 的二进制文件）
- **Linter**：Biome（`npx biome check --write`）
- **模块类型**：仅 ESM（所有包中 `"type": "module"`）

## 设置

```bash
git clone https://github.com/evaijs/evjs.git
cd evjs
npm install
```

## 命令

```bash
npm run build              # 构建所有包 + 示例
npm run test               # 单元测试（vitest）
npm run test:e2e           # E2E 测试（playwright）
npm run dev                # 开发模式（turborepo）
npx biome check --write    # 修复 lint/格式
```

## 编码规则

1. **导入** —— 所有导入放在文件顶部。类型导入使用 `import type`
2. **Lint** —— Biome 强制执行；禁止 `any`，禁止 `import * as`（除非必要）
3. **页面路由** —— 默认以 `src/pages` 为事实来源。路由文件使用 `.tsx`、`.jsx`、`.ts`
   或 `.js`；动态段使用 `$param`；`index` 映射到目录根路径；`(group)` 段是 pathless
   分组；`_` 前缀文件/目录是私有模块；bracket、catch-all、空动态段和可选段暂不支持
4. **布局** —— SPA 根布局只会从路由目录旁边的 `layout/index.tsx` 自动发现。
   嵌套 SPA route layout 放在某个路由段下，使用 `layout.*` 源码模块。MPA
   路由不消费框架 layout
5. **服务端函数** —— 必须以 `"use server";` 开头，并使用 `.server.ts` 或
   `.server.tsx` 文件名；server functions 没有目录约定
6. **服务端函数导出** —— 只使用命名可调用导出：function declaration 或
   `const` arrow/function expression。不使用默认导出、跨模块 re-export 或导出非函数值
7. **配置文件** —— 命名为 `ev.config.ts`（不是 `evjs.config.ts`）
8. **包边界** —— config/build 导入保留在 `@evjs/ev`。file-convention 应用源码从
   `@evjs/ev/route` 导入 route data helpers，从 `@evjs/ev/server-context` 导入 request helpers，
   从 `@evjs/ev/transport` 导入自定义 transport helpers；standalone/manual runtime
   imports 使用 `@evjs/client` 和 `@evjs/server`。新增分发包前先优先在拥有该行为的包中使用
   subpath export。Subpath export 应保持显式且有文档说明，不要为了方便导入增加别名。
   `@evjs/cli` 持有默认 Utoopack adapter；
   `@evjs/shared` 是共享契约包，不是应用 API
9. **渲染契约** —— 非 CSR 渲染模式需要 `server` 输出。PPR 和 RSC 必须使用
   component page module，并声明 `render: "ssr"`；同一页面同时启用 PPR + RSC
   在 runtime 支持前暂不支持
## 发布新版本

1. 创建一个带有标签（如 `v0.1.0`）的 GitHub Release
2. 发布工作流自动同步版本并发布到 npm
3. **不要在本地修改版本号** —— 代码库对内部依赖使用 `"*"`
