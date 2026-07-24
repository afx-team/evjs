# 插件迁移：Core 0.2 到 0.3

本文描述已经确认的 Core 0.3 插件迁移合同。带 namespace 的 Page extension 与跨
SPA/MPA canonical Page-directory raw-config claim 当前已经可以执行。Graph transform、
typed runtime hook、semantic facet 和 generic extension entry 仍是目标 API，下文会明确
标注。当前 0.2 行为也会被明确标出。

架构背景见 [Core 0.3 设计 RFC](./core-0.3-rfc)。

## 迁移结果

完成迁移的插件应当：

- 在读取 config 前声明自己拥有的 config/capability namespace；
- target semantic Application、Page、Route、Document facet，不从 entry name 猜 owner；
- 用有顺序、不可变、带 provenance 的 patch 表达 graph 变化；
- 继续通过 opaque ref/import edge 把 generated code 放进 `.ev`；
- 通过真正被执行的 typed hook 注册 runtime 行为；
- 只有缺少稳定 semantic facet 的能力才使用 bundler、HTML AST、dev、output
  escape hatch；
- 在 SPA/MPA 中消费同一 normalized graph，或显式声明不支持某种 topology。

迁移不等于模拟 Umi/Bigfish/Smallfish hook name、任意 tmp file，或提供
bundler-neutral webpack-chain API。

## 先给 0.2 插件分类

| 0.2 行为 | 迁移类别 | 0.3 归属 |
| --- | --- | --- |
| `name`、dependencies、optional dependencies | 机械迁移 | plugin identity/dependency graph |
| `enforce` | 需要复核 | 显式 dependency/order；dependency 优先 |
| 简单 config default/validation | 机械迁移 | `describe()` extension schema/default |
| 任意 raw `config()` mutation | 语义重写 | schema + ordered config normalizer |
| `setup()` 状态 | 通常机械迁移 | project config 校验后的 deterministic state |
| `emit.module()` / `emit.data()` | 机械迁移 | 保留 opaque-ref 模型的 generated artifact |
| `emit.entryFacade()` | 需要复核 | wrap 命名 semantic facet 或 materialized entry |
| app-owned `client.entry` | 机械迁移 | `application.bootstrap` 或 `document.entry` |
| MPA page-owned `client.entry` | 需要复核 | 通常是 `page.module` 或 `page.activation` |
| SPA page-owned `client.entry` | 语义重写 | `page.module`；SPA Page 不拥有 entry |
| 带 `runtime: "server"` 的 `client.entry` | 非法，必须重写 | client-entry slot 只接受 `client` 或 `all`；server code 使用 server request/entry facet |
| 旧 `client.runtime.plugin` | 语义重写 | 通过 `client.entry` 调用显式 installer，或使用 feature-specific typed hook |
| `html.tag` | 复核 owner 后机械迁移 | `document.html` |
| `server.request.middleware` | 机械迁移 | server request facet |
| `resolve.alias` / `resolve.external` | 机械迁移 | 保留 resolution facet |
| `transformHtml()` | 复核 owner 后机械迁移 | Document AST transform |
| `bundlerConfig()` | 保留 escape hatch | adapter-specific callback |
| `buildOutput()` mutation | 需要复核 | namespaced output projection/output lifecycle |
| `buildStart/buildEnd/dispose` | 通常机械迁移 | 对应 lifecycle phase |
| render/RSC/PPR 假设 | 语义重写 | 可选 rendering extension，不是 Core 字段 |

当前 Core 0.2 实现没有 `client.route` slot。旧文档误列了它，但 `FrameworkSlotName`
和实现中都不存在。迁移 route 行为时以插件真实代码为准，不以旧文档表格为准。

## 阶段映射

插件 API 的所有 deterministic phase 使用同一 dependency order。`describe()` 每个
command 只在 `setup()` 前运行一次，解析后的 extension 可供
`contributions()` 使用。以下完整阶段中的 transform、runtime、facet 和 generic-entry
阶段仍是目标行为。

```text
bootstrap
  -> describe
  -> resolve project/provider config
  -> allocate deterministic setup state
  -> discover identities and source scopes
  -> resolve colocated page config
  -> normalize the initial graph
  -> apply declarative graph contributions
  -> final graph validation
  -> declare generated artifacts and semantic facet attachments
  -> validate contribution targets and cardinality
  -> materialize generated modules, entries, runtime hooks, and documents
  -> configure the selected adapter
  -> adapter/build/output lifecycle
  -> reverse-order dispose
```

| 阶段 | 允许的工作 | 不能在此执行 |
| --- | --- | --- |
| `bootstrap` | 解析 plugin package、instance id、options、dependencies。 | 读取项目 page config 或修改 graph。 |
| `describe` | 注册 extension schema/default、source provider、capability、runtime hook。 | network call、generated file、读取未校验 config。 |
| `resolve project config` | 合并/校验 discovery 所需的 project/provider config。 | Page root 尚不存在时读取 colocated page config。 |
| `setup` | 从已校验 config 与已声明的本地项目输入分配 deterministic in-memory state。 | Network call、external write、平台 mutation，或使用会改变 graph 的未声明事实。 |
| `discover` | Provider 声明 Application、Page identity/scope、Route、Document、watch input。 | 修改其他 provider 拥有的 declaration。 |
| `resolve page config` | 合并内建/plugin default、declaration、colocated config 与有序 normalizer。 | 修改 Page id/provider/scope 等身份字段。 |
| `normalize` | Core 把 provider declaration 转成初始 immutable graph。 | 向 normalized protocol 加入 provider-specific 字段。 |
| `transform` | 返回 structured graph patch 和带 provenance diagnostic。 | 任意原地修改 graph。 |
| `final validation` | 每个 patch 后重新执行 identity、conflict、path-shape、target、ownership 校验。 | 通过静默丢弃 declaration 修复冲突。 |
| `contribute` | 声明 generated module/data/type 及其 semantic facet attachment。 | 写 generated file、修改已校验 identity，或执行 external side effect。 |
| `target validation` | 解析每个显式 target，并执行零匹配、多匹配、replacement cardinality 规则。 | 从 entry/output filename 猜 owner。 |
| `materialize` | Core 写入已声明 artifact，并物化 Document、Page module/activation facet、runtime hook、generic build entry。 | 把 provider semantic 放进 bundler adapter，或加入未声明 contribution。 |
| `configure adapter` | 把已校验 generic entry 与 resolution facet 投影给所选 adapter。 | 添加 Core 与 `ev inspect` 不可见的 graph semantic。 |
| lifecycle | 执行 dev middleware、build/output/deployment 工作与 cleanup。 | 隐藏本应可 inspect 的 graph semantic。 |

影响 graph 的本地项目读取必须声明为 watch input。Network call、external write、平台
mutation 属于 lifecycle，不能为更早的 deterministic phase 暗中提供事实。

## 当前可运行的 Page Extension 形态

canonical 应用在 `page.config.ts` 中 author value：

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  extensions: {
    "@company/feature": {
      enabled: true,
      channel: "checkout",
    },
  },
});
```

能力所属插件注册同一个 namespace：

```ts
import { definePlugin } from "@evjs/ev/plugin";

type FeatureValue = {
  enabled: boolean;
  channel: string;
};

export const featurePlugin = definePlugin({
  name: "feature",
  dependencies: ["another-plugin"],

  describe(api) {
    api.pageExtension<FeatureValue, Partial<FeatureValue>>({
      namespace: "@company/feature",
      defaults: { enabled: false, channel: "web" },
      merge(defaults, configured) {
        return { ...defaults, ...configured };
      },
      validate(value) {
        return value.channel.length > 0 || "channel must not be empty";
      },
    });
  },

  contributions(ctx) {
    const pages = ctx.framework.pages.map((page) => ({
      id: page.id,
      feature: page.extensions["@company/feature"],
    }));
    console.log(pages);
  },
});
```

`definePlugin()` 是唯一 `Plugin` interface 的类型辅助函数。未提供自定义 `merge`
时，plain object 按 defaults < configured value 浅合并；其他 configured value 会
替换 defaults。Page 未配置该 namespace 时会直接物化 defaults，不调用自定义
`merge`，因此它的 `configured` 参数始终是作者显式提供的值。defaults 函数、`merge`
和 `validate` 都是同步的。value 必须严格可 JSON 序列化。

Page extension 支持 normalized CoreGraph Page；canonical `page.tsx` anchor 在两种
mode 中都会提供，显式
route-tree 迁移输入必须 normalize 到同一 graph。现有 lifecycle hook 和
`describe()` 同属一个 `Plugin` interface，并走同一执行路径。

Contribution view 会暴露已注册的 Page extension。Application、Route 和 Document
extension 在 owner API 落地前会被拒绝。迁移后的 generated-contribution 代码无需
访问 `.ev` internal 就能消费 Page value。它不会把配置自动暴露到 runtime；浏览器
行为仍需要显式 generated runtime projection。

### 当前 MPA target 行为

canonical MPA 已经暴露一个逻辑 `default` Application。在现有 generated-
contribution slot 中，Application target 会把 `client.entry` 展开到该 Application 的全部
page-client entry，并把 `html.tag` 展开到全部 Document；Page target 仍精确选择一个
已物化的 Page entry 或 Document。这是已经落地的行为；下一节的 semantic facet
仍是目标 API。显式 route-tree 输入必须先 normalize 到相同 ownership。

## 目标 Graph、Runtime 与 Facet 形态

以下职责仍是设计目标，并非已经实现的 API：

```ts
// 仅表示目标形态；这些 member 当前尚不能编译。
definePlugin({
  name: "future-example",
  transformGraph(ctx) {
    return ctx.patch.addRoute(/* structured declaration */);
  },
  contribute(ctx) {
    ctx.facet("page.module", "home").add(/* ModuleRef */);
  },
  describe(api) {
    api.runtime.defineHook(/* typed runtime hook */);
  },
});
```

可执行行为仍会是 `ModuleRef`，绝不会把函数序列化进 graph。

## Facet 映射

| Facet | Cardinality 与用途 |
| --- | --- |
| `application.bootstrap` | 在启动逻辑 Application 的每个 browser entry 中执行：典型 SPA 一次，MPA 每个 Page Document 一次。 |
| `page.module` | 每个 Page definition 恰好 wrap/augment 一次，不受 SPA/MPA entry topology 影响。 |
| `page.activation` | 可选 Page enter/leave lifecycle；不隐含 model isolation 或 lazy state。 |
| `route.definition` | 带 conflict validation/provenance 地 add/replace/wrap normalized Route。 |
| `document.entry` | 影响一个指定 Document 的 bootstrap entry。 |
| `document.html` | 对一个 Document 恰好添加一次 structured tag/transform。 |
| `build.entry` | 声明 extension-owned client/server/build entry，包含 owner、environment、phase、capability；Core 不理解 capability 名。 |
| `server.request` | 增加 server capability 拥有的 request middleware/endpoint。 |
| `resolve.alias` / `resolve.external` | 保留 semantic resolution contribution。 |

显式 target 零匹配时必须报错。多个 replacement 也是错误，除非 facet 明确定义
composition。Application 展开到多个 MPA entry/Document 的过程必须 deterministic，
并在 `.ev`、`ev inspect` 中可见。

## 常见迁移模式

### 将 config ownership 移到 `describe()`

0.2 插件经常修改 raw config：

```ts
config(config) {
  return { ...config, feature: { enabled: true, ...config.feature } };
}
```

在当前插件 API 中，在同步 `describe()` 中注册 Page namespace、default 与
merge/validation callback。canonical resolver 或显式 route-tree
normalizer 先发现 Page identity/scope，registry 再解析 namespaced
`page.config.ts` extension，而且不能修改内部 id、source provenance、scope 等
身份字段。
通用 schema 生成和有顺序的 cross-field normalizer 仍是未来工作。

Bigfish access/menu route metadata 与 Smallfish CAPR/Tracert/launch parameters 分属
不同 namespace，不能加入 Core Page/Route 类型。

### 保留 generated artifact，改变挂载点

`emit.module`、`emit.data`、opaque ref、generated import edge 都保留，大多数 generated
source 可原样迁移。把旧 entry-name target 换成 semantic facet：

```text
global installer          -> application.bootstrap
page wrapper/provider     -> page.module
page enter/leave behavior -> page.activation
per-document bootstrap    -> document.entry
meta/link/script/style    -> document.html
```

Smallfish 风格 page plugin 当前已经可以在 `contributions()` 中遍历 resolved Pages 并
读取 `page.extensions`。把 generated module 挂到未来 `page.module` facet 仍是目标行为；
现阶段应使用受支持的 contribution slot，并且不能假设每个 Page 都有独立 client
entry。

### 有意识地重写 runtime plugin

旧 0.2 `client.runtime.plugin` 只 import module namespace 并记录一份 Core 从未调用
的数组。Core 0.3 不暴露这条 inert slot。迁移方式：

- side-effect installer：通过 `client.entry` 显式 import 并调用；
- root/provider composition：typed `compose` runtime hook；
- navigation notification：typed `event` hook；
- option transformation：typed `modify` hook；
- page-specific behavior：`page.module` 或 `page.activation`。

不要复制 `patchRoutes`、`rootContainer`、`render` 等 export-name probing。注册并消费
一个 typed hook contract。

### 将 HTML target 改成 Document

0.2 HTML owner 从其 `app`/`page` build output 推导。Core 0.3 structured tag/AST
transform target Document id 或 selector。

- MPA Page：通常对应一个 Document；
- SPA Page：没有 page-owned Document；静态 tag target Application Document，随 route
  变化的 metadata 使用 route/runtime head capability；
- Application：可以展开到多个 MPA Document，展开必须显式。

不要从 HTML filename 推断 target。

### 用 graph patch 替代 route mutation

Route 变化使用 normalized Page/Route declaration 与 immutable add、replace target、wrap、
patch one extension namespace 等操作。每个 patch 记录 plugin、instance、phase、dependency
order，并经过与 source provider 相同的 id/parent/path-shape/ownership 校验。

不要在 generated code 内引入第二套 route dialect。Bigfish `:id`、evjs `$id`、file path
都由 provider 在 graph patch 前解析。

### 把 rendering 移出 Core 假设

读取 `render`、`componentModel`、`prerender`、`ppr` 或内建 renderer entry kind 的
插件必须迁移到 rendering extension，由它拥有：

- page capability schema；
- generic server/build entries；
- request endpoint/middleware；
- Document production/transform；
- namespaced cache、streaming、deployment metadata。

Bundler adapter 只看到 generic entry/build fact，不含 SSR/PPR/RSC 分支。

## 不提供 Runtime Compatibility Adapter

Core 0.3 不通过 compatibility adapter 托管 0.2 plugin object。每个插件源码都要
迁移到唯一 `Plugin` contract。机械转换工具可以生成源码修改或 diagnostic，但不能
安装第二套 plugin runtime，也不能在应用运行时重新解释旧 hook。

## 推荐迁移步骤

1. 盘点 0.2 plugin 的每个 hook、generated file、target、runtime export、route change、
   bundler mutation。
2. Page-owned static config 放入已注册 Page extension，并定义
   schema/default/merge behavior。不要写入无 owner 的 Application、Route 或
   Document extension；等待明确 owner API，或使用现有 generated/lifecycle facet。
3. 为每个 generated artifact 选择 semantic facet，标出所有依赖 entry name/HTML filename
   的 target。
4. 将 raw config、discovery、graph transform、generated contribution declaration、
   materialization、side-effect lifecycle 拆入对应 phase。
5. 用显式 installer 或 typed hook 替换 runtime side effect/export probing。
6. 移除 Page URL、Document、entry、render mode 一对一假设。
7. 在一份 SPA 和一份 MPA graph 上测试，即使插件有意拒绝其中一种 topology。
8. 检查 `.ev` 中的 producer、target expansion、generated import、conflict order。
## 迁移插件的必测项

- schema default 与 invalid config diagnostic；
- required/optional dependency 的 deterministic ordering；
- SPA/MPA 中 `page.module` 都对每个 Page 恰好生效一次；
- Application contribution 在 SPA 一次、MPA 所有目标 entries/Documents 中正确展开；
- Document HTML contribution 不泄漏、不重复；
- zero-match target 和 multiple replacement diagnostic；
- generated module import edge 与 watch input；
- runtime hook invocation order 与 reverse-order cleanup；
- Webpack/Utoopack 消费同一 semantic BuildPlan；
- `ev inspect` 显示 plugin instance、graph patch、facet、materialized entry/Document；
- plugin 不依赖任何 Core SSR/PPR/RSC 字段。
