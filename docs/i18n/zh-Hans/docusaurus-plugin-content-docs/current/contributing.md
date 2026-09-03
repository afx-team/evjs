# 贡献指南

> evjs 单仓库的内部开发指南。

## 项目信息

- **名称**：evjs，包命名空间 `@evjs/*`
- **仓库**：[afx-team/evjs](https://github.com/afx-team/evjs)
- **CLI**：`@evjs/cli` 提供的 `ev`
- **代码检查**：Biome
- **模块**：仅 ESM

## 设置

```bash
git clone https://github.com/afx-team/evjs.git
cd evjs
npm install
```

## 命令

```bash
npm run build
npm run test
npm run test:e2e
npm run check-types
npm run lint
npx biome check --write
```

## 编码规则

1. 导入语句放在文件顶部，纯类型使用 `import type`。
2. 使用 Biome 格式化并检查代码。没有明确理由时，避免 `any` 和宽泛的命名空间导入。
3. 新应用统一使用文件页面模型：`src/pages/**/page.*`、可选的构建期
   `page.config.ts`、由目录决定的 URL，以及 `routing.mode`。
4. 页面专属组件、Hook 函数、模型、服务、测试和样式放在页面目录中，不需要 `_` 前缀。
5. 文件式客户端路由使用 `$param`、末尾 `$...splat` 和 `(group)` 目录。API 路由使用
   `src/apis/**/api.*`，URL 由目录决定。
6. 新示例使用 `page.*`、`page.config.ts` 与 `routing.mode`；显式
   `application.routes` 只放在专门的配置路由测试用例中。
7. 服务端函数以 `"use server";` 开头，只使用命名函数导出。
8. 配置和构建代码从 `@evjs/ev` 导入；应用源码使用
   `@evjs/ev/api`、`/route`、`/navigation`、`/query`、`/server-context`、
   `/transport`。直接使用运行时的应用从 `@evjs/client` 或 `@evjs/server` 导入。
9. 框架语义放在 `@evjs/ev` 的构建内部模块中，标准化契约放在
   `@evjs/shared/manifest`；构建器适配器只消费 `BuildPlan` 并返回构建结果。
10. `.ev`、`dist`、`.turbo`、`node_modules` 与路由类型声明都是生成产物。
11. 中间件集合字段和参数使用 `middlewares`。
    单个函数类型使用 `MiddlewareHandler`，有序链类型使用 `MiddlewareChain`。
    能力、钩子和模块名称使用单数：`server.request.middleware`、
    `clientDevMiddleware` 和 `middleware.*`。具体中间件工厂按行为命名，
    例如 `requestLogger()`。

## 常见任务

### 添加页面路由

1. 创建 `src/pages/<url-segments>/page.tsx`。
2. 默认导出页面组件。
3. 需要时使用 `$param`、末尾 `$...splat` 或 `(group)` 目录。
4. 页面专属源码放在同一目录，不需要 `_` 前缀。
5. 页面需要静态标题、命名元信息、渲染字段或已安装插件的页面选项时，添加
   `page.config.ts`。页面插件选项需要在运行时使用时，由插件显式生成对应代码。

### 添加服务端函数

1. 在调用方或领域代码旁创建 `[name].server.ts`，并从应用中导入它。
2. 顶部添加 `"use server";`。
3. 命名导出异步函数。
4. 通过 `@evjs/ev/query` 调用。

### 添加 API 路由

1. 在 `src/apis` 下创建 URL 对应目录并添加 `api.ts` 文件。
2. 从该文件导出 `GET`、`POST` 等大写 HTTP 方法处理器。
3. 辅助代码放在同目录的普通非 `api.*` 模块中。
4. 在 `src/middlewares/middleware.ts` 中组合有序的全局中间件，默认导出单个函数或非空数组。
5. 使用 `@evjs/ev/api` 的 `withMiddlewares(handler, middlewares)` 组合各方法的策略，
   通过普通模块导入复用共享链。

### 添加示例

1. 在 `examples/` 下添加私有工作区包。
2. 使用 `routing.mode` 与 `page.*` 路由目录。
3. 添加 `index.html` 和所需工作区依赖。
4. 只有示例也作为正式用户模板时，才新增或更新 create-app 映射。
5. 添加针对性的单元测试和端到端测试。
6. 显式路由树用例放在名称清晰的配置路由测试夹具中，不要放进用户模板。

### 修改页面或路由约定

1. 先更新配置解析与语义图标准化逻辑。
2. 同时更新中英文 `project-structure`、`file-conventions`、配置文档与相关示例。
3. 补充语义图、诊断、脚手架与配置路由测试。
4. 运行仓库完整校验。

### 发布新版本

1. 使用待发布版本的 `vX.Y.Z` 标签创建 GitHub Release。
2. 发布自动化会同步内部包版本并完成发布。
3. 不要在本地修改工作区内部的 `"*"` 依赖。
