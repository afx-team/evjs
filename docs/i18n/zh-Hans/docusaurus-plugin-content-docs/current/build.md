# 构建

生成生产产物前先检查应用：

```bash
ev inspect
ev build
```

## 命令

| 命令 | 用途 | 是否写入产物？ |
| --- | --- | --- |
| `ev inspect` | 校验配置、路由、渲染、插件与构建器能力 | 否 |
| `ev inspect --json` | 把同一份应用摘要提供给工具 | 否 |
| `ev prepare` | 不打包，只生成框架入口与声明 | `.ev` 与生成声明 |
| `ev build` | 生成生产浏览器/服务端产物 | `.ev`、声明与 `dist` |

同一项目一次只能有一个 `dev`、`prepare` 或 `build` 操作修改输出。

## 先 Inspect

`ev inspect` 使用公共应用概念报告：

- SPA 或 MPA 模式；
- 已发现页面及其 URL 形态；
- HTML 文档与渲染选择；
- 服务端函数与 API 路由；
- 已安装插件与页面设置；
- 所选构建器及缺失能力；
- 带源码位置的诊断。

非零退出表示配置或应用结构错误。在 CI 中可以把 Inspect 放在生产构建前，以获得更快、更聚焦的反馈。

## 生产产物

默认布局把浏览器与服务端文件分开：

```text
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   └── ...
├── server/                          # 需要服务端工作时存在
│   └── ...
└── deployment-metadata.json
```

- `dist/client` 包含 HTML、JavaScript、CSS 与公共资源。
- `dist/server` 包含服务端函数、API 路由、SSR、PPR 或 RSC 所需的服务端包。
- `deployment-metadata.json` 供部署工具消费，应用代码不应导入或编辑。

把 `.ev`、`dist`、`src/route-types.d.ts` 和 `src/plugin-types.d.ts` 当作生成产物。

## 修改输出目录

主机要求另一种目录布局时使用 `output.client` 和 `output.server`：

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  output: {
    client: "dist/public",
    server: "dist/runtime",
  },
});
```

两个路径必须保持为 `dist` 下分离且不嵌套的后代，并使用可移植 `/` 分隔符，不能包含空、`.` 或 `..` 段。

`output.crossOriginLoading` 接受 `false`、`"anonymous"` 或 `"use-credentials"`，用于控制生成资源标签与动态 Chunk 加载的 `crossorigin`。

## SPA 产物

普通 CSR SPA 生成一份应用文档和浏览器路由资源。静态 SSG 页面还会在路由路径生成 HTML：

```text
/           -> dist/client/index.html
/report     -> dist/client/report/index.html
```

请求时 SSR、PPR 与 RSC 路由使用服务端产物，不是独立静态 HTML 文件。

## MPA 产物

MPA 为每个静态页面路由创建一份 HTML：

```text
/           -> dist/client/index.html
/report     -> dist/client/report.html
/foo/bar    -> dist/client/foo/bar.html
```

相邻 `index.html` 提供页面专属模板。动态 `$param` 与 `$...splat` 路径会被拒绝，因为一个动态形态无法命名一份构建时文档。

SSR MPA 页面仍需要服务端部署目标。若没有其他服务端能力，CSR 与 SSG MPA 页面可以静态部署。

## 浏览器兼容性

生产兼容能力需显式启用：

```ts title="ev.config.ts"
export default defineConfig({
  target: {
    android: 6,
    ios: 10,
  },
});
```

这会降低生产客户端语法，并为 ECMAScript 内建能力加入 core-js。开发环境仍按活动构建器优化。若要从独立 UMD 文件加载 core-js，使用绝对 HTTP(S) URL 配置 `polyfill.coreJs`。

校验和作用域见[配置](./config#浏览器兼容性)。

## 渲染要求

渲染选择可能要求不同构建与部署能力：

| 页面行为 | 浏览器产物 | 服务端产物 | 仅静态托管？ |
| --- | --- | --- | --- |
| CSR | 客户端入口 | 无 | 可以 |
| SSR | 可选 Hydration 入口 | 渲染器 | 不可以 |
| SSG | 生成 HTML，可选 Hydration | 仅构建时 | 可以，除非其他功能需要服务端 |
| PPR | 外壳/客户端资源（按需） | 运行时渲染器 | 不可以 |
| RSC | 客户端组件资源 | 运行时渲染器 | 不可以 |

选择 PPR 或 RSC 后运行 `ev inspect`，确认所选构建器支持该页面。完整配置矩阵见[渲染](./rendering)。

## 构建前检查

交付前确认：

- `routing.mode` 是有意选择；
- 每个公共页面只有一个 `page.*` 变体并默认导出组件；
- 路由目录只使用有效静态、`$param`、终止 `$...splat` 或 `(group)` 段；
- MPA 页面只使用静态路径，不使用路由器专属边界；
- 每个 `page.config.*` 导出受支持的静态数据；
- 服务端函数模块以 `"use server";` 开头并命名导出可调用值；
- 每个公共 API 路由只有一个 `api.*` 锚点并导出大写 HTTP 方法；
- 页面路由、重定向、API 路由与框架端点没有冲突；
- HTML 模板包含配置的挂载元素；
- 部署目标支持全部服务端与渲染能力。

然后运行项目自身的类型、Lint 与测试检查，再执行：

```bash
ev inspect
ev build
```

## 下一步

在[部署](./deploy)中选择目标与适配器。如果产物不符合预期，请先对比 `ev inspect` 的应用结果与源码树，再检查生成文件。
