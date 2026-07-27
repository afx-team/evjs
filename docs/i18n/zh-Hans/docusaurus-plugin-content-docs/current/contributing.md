# 贡献指南

> evjs 单仓库的内部开发指南。

## 项目信息

- **名称**：evjs，包 scope `@evjs/*`
- **仓库**：[evaijs/evjs](https://github.com/evaijs/evjs)
- **CLI**：`@evjs/cli` 提供的 `ev`
- **Linter**：Biome
- **模块**：仅 ESM

## 设置

```bash
git clone https://github.com/evaijs/evjs.git
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

1. Import 放在文件顶部，纯类型使用 `import type`。
2. 使用 Biome formatting/linting。没有具体理由时避免 `any` 与宽泛 namespace
   import。
3. 新应用只使用一种 Page-and-Route 模型：
   `<routing.dir>/**/page.*`、可选构建期 `page.config.ts`、目录派生 URL 与
   `routing.mode`。
4. Page 私有组件、hook、model、service、测试、样式放入 Page 目录，不需要 `_`。
5. canonical client route 目录使用 `$param`、终止 `$...splat` 与
   `(group)`。Server file route 继续位于 `src/apis` 并使用其文档规定的
   filename 语法。
6. 新示例使用 canonical `page.*`、`page.config.ts` 与 `routing.mode`；显式
   `application.routes` 只用于覆盖 config-route normalizer 的聚焦 fixture。
7. Server function 以 `"use server";` 开头，只导出命名 callable。
8. Config/build import 保留在 `@evjs/ev`；应用源码使用
   `@evjs/ev/route`、`/navigation`、`/query`、`/server-context`、
   `/transport`。Standalone runtime 直接导入 `@evjs/client`/`@evjs/server`。
9. 框架语义位于 `@evjs/ev` build internal，normalized contract 位于
   `@evjs/shared/manifest`；bundler adapter 只消费 BuildPlan 并返回事实。
10. `.ev`、`dist`、`.turbo`、`node_modules` 与 route-type declaration 都是
    生成物。

## 常见任务

### 添加 Page 路由

1. 创建 `src/pages/<url-segments>/page.tsx`。
2. 默认导出 Page component。
3. 需要时使用 `$param`、终止 `$...splat` 或 `(group)` 目录。
4. Page 私有源码放在同一目录，不需要 `_` 前缀。
5. Page 需要静态标题、受支持的 named metadata、core rendering 字段或已注册
   namespaced plugin extension 时添加 `page.config.ts`；extension 值供 runtime
   消费时需要插件显式投影。

### 添加服务端函数

1. 在调用方或领域代码旁创建 reachable `[name].server.ts`。
2. 顶部添加 `"use server";`。
3. 导出命名 async callable。
4. 通过 `@evjs/ev/query` 消费。

### 添加服务端文件路由

1. 在 `src/apis` 下创建模块。
2. 导出 `GET`、`POST` 等大写 HTTP handler。
3. Helper 保持为普通 colocated module。
4. Middleware 使用 `src/middleware.ts` 或
   `src/apis/**/middleware.ts`。

### 添加示例

1. 在 `examples/` 下添加 private workspace package。
2. 使用 canonical `routing.mode` 与 `page.*` route directory。
3. 添加 `index.html` 和所需 workspace dependency。
4. 只有作为支持的用户模板时才新增/更新 create-app mapping。
5. 添加聚焦 unit/e2e validation。
6. 显式 route-tree 方言放在名称清晰的 config-route fixture，不进入 canonical
   template。

### 修改 Page 或 Route 约定

1. 先更新 config resolution 与 graph normalization。
2. 同时更新中英文 `project-structure`、`file-conventions`、config 与相关 example。
3. 补充 graph、diagnostic、scaffold 与 config-route coverage。
4. 运行仓库 validation gate。

### 发布新版本

1. 创建 `v0.3.0` 等 tag 的 GitHub Release。
2. Release automation 同步内部 package version 并发布。
3. 不要在本地修改 workspace internal `"*"` dependency。
