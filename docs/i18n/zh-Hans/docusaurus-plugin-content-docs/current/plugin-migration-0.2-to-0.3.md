# 插件迁移：Core 0.2 到 0.3

本文描述已经确认的 Core 0.3 插件迁移合同。带 namespace 的 Application、Page、
Route、Document extension，以及跨 SPA/MPA canonical Page-directory 静态配置，
当前已经可以执行。Graph transform、typed runtime hook、generic semantic facet
API 和 generic build entry 仍是目标 API，下文会明确标注。当前 0.2 行为也会被
明确标出。

架构背景见 [Core 0.3 设计 RFC](./core-0.3-rfc)。Bigfish、Smallfish 的源码能力
证据和应用迁移顺序见
[Bigfish、Smallfish 迁移](./framework-migration-to-0.3)。

## 迁移结果

完成迁移的插件应当：

- 在 extension value 解析前声明自己拥有的 config/capability namespace；
- 读取 normalized Application、Page、Route、Document view，不从 entry name
  反推 owner；
- 继续通过 opaque ref/import edge 把 generated code 放进 `.ev`；
- 通过 `client.entry`、`page.wrapper`、`server.request.middleware`、
  `html.tag` 与 resolution contribution 挂载当前支持的行为；
- runtime side effect 使用显式 client installer；
- 只有缺少当前 structured contribution 的能力才使用 bundler、HTML AST、
  dev、output lifecycle hook；
- 在 SPA/MPA 中消费同一 normalized graph，或显式声明不支持某种 routing mode。

迁移不等于模拟 Umi/Bigfish/Smallfish hook name、任意 tmp file，或提供
bundler-neutral webpack-chain API。

Immutable graph transform、typed runtime hook、generic extension entry 与更完整
semantic facet 模型仍是 planned API。它们是本文后续的设计目标，不是插件迁到当前
Core 0.3 实现的前置要求。

## 先给 0.2 插件分类

| 0.2 行为 | 迁移类别 | 0.3 归属 |
| --- | --- | --- |
| `name`、dependencies、optional dependencies | 机械迁移 | plugin identity/dependency graph |
| `enforce` | 需要复核 | 显式 dependency/order；dependency 优先 |
| 简单 config default/validation | 机械迁移 | 匹配的 `describe()` Application/Page/Route/Document owner declaration |
| 任意 raw `config()` mutation | 需要复核 | framework config 使用当前 `config()` hook；有 owner 的静态配置使用 namespaced extension；ordered normalizer 仍为 planned |
| `setup()` 状态 | 通常机械迁移 | project config 校验后的 deterministic state |
| `emit.module()` / `emit.data()` | 机械迁移 | 保留 opaque-ref 模型的 generated artifact |
| `emit.entryFacade()` | 需要复核 | wrap 命名 semantic facet 或 materialized entry |
| app-owned `client.entry` | 机械迁移 | 当前 Application-targeted `client.entry`；planned `application.bootstrap` / `document.entry` facet |
| MPA page-owned `client.entry` | 需要复核 | Page component 包装迁到 `page.wrapper`；side-effect installer 仍属于 client-entry 行为 |
| SPA page-owned `client.entry` | 语义重写 | Page composition 使用 `page.wrapper`；SPA Page 仍不拥有 entry |
| 带 `runtime: "server"` 或 `"all"` 的 `client.entry` | 非法，必须重写 | client-entry slot 只接受 `client`；跨 runtime Page composition 使用 `page.wrapper` |
| 旧 `client.runtime.plugin` | 语义重写 | Page component transform 使用 `page.wrapper`；side effect 使用显式 `client.entry` installer |
| `html.tag` | 复核 owner 后机械迁移 | 当前 `html.tag` Document contribution |
| `server.request.middleware` | 机械迁移 | 当前 server request middleware contribution |
| `resolve.alias` / `resolve.external` | 机械迁移 | 保留 resolution facet |
| `transformHtml()` | 复核 owner 后机械迁移 | Document AST transform |
| `bundlerConfig()` | 保留 escape hatch | adapter-specific callback |
| `buildOutput()` mutation | 需要复核 | 当前 `buildOutput()` lifecycle；namespaced output projection 仍为 planned |
| `buildStart/buildEnd/dispose` | 通常机械迁移 | 对应 lifecycle phase |
| render/RSC/PPR 假设 | 语义重写 | 当前 `page.config.ts` Core Page 字段；插件不能推断内部 renderer entry kind |

当前 Core 0.2 实现没有 `client.route` slot。旧文档误列了它，但 `FrameworkSlotName`
和实现中都不存在。迁移 route 行为时以插件真实代码为准，不以旧文档表格为准。

## 当前可执行阶段

插件 API 的所有 deterministic phase 使用同一 dependency order。`describe()` 对每轮
resolved plugin configuration 执行一次；dev config reload 会新建一轮 resolution。
Application extension 在 `setup()` 前解析，并通过 `ctx.config.extensions` 暴露；
Page、Route、Document extension 更晚针对 normalized graph owner 解析，并可供
`contributions()` 使用。

```text
config
  -> resolve project config
  -> describe
  -> resolve Application extensions
  -> setup
  -> buildStart
  -> discover Pages/Routes/Documents and evaluate page.config.ts
  -> resolve Page/Route/Document extensions and validate CoreGraph
  -> create BuildPlan
  -> contributions and target validation
  -> materialize .ev
  -> bundlerConfig
  -> adapter build
  -> buildOutput
  -> transformHtml
  -> buildEnd
  -> reverse-order dispose
```

## 目标阶段模型（Planned）

下面更完整的阶段模型是设计目标。`transform`、typed runtime hook、generic facet
与 generic-entry 行并不表示当前版本已经提供可调用 API。

```text
bootstrap
  -> resolve project/provider config
  -> describe
  -> resolve Application extensions
  -> allocate deterministic setup state
  -> discover identities and source scopes
  -> resolve colocated page config
  -> normalize the initial graph
  -> resolve Page/Route/Document extensions on the normalized graph
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
| `resolve project config` | 先运行 config hook，再合并/校验 discovery 所需的 project/provider config。 | Page root 尚不存在时读取 colocated page config。 |
| `describe` | 注册 extension owner、default、merge/validation、source provider、capability、runtime hook。 | network call、generated file、读取未校验 config。 |
| `resolve Application extensions` | 解析已注册的顶层 value，并 deep-freeze 暴露给 `setup()` 的 snapshot。 | 读取 Page-owned config，或把 declaration callback 序列化为 graph data。 |
| `setup` | 从已校验 config、已解析的 `ctx.config.extensions` 与已声明的本地项目输入分配 deterministic in-memory state。 | 在 normalized graph 生成前读取 Page/Route/Document extension；执行 network call、external write、平台 mutation，或使用会改变 graph 的未声明事实。 |
| `discover` | Provider 声明 Application、Page identity/scope、Route、Document、watch input。 | 修改其他 provider 拥有的 declaration。 |
| `resolve page config` | 求值内建 Page 字段，并收集 colocated config 中的静态 namespaced value。 | 在 Page identity 存在前按 owner 解析 value，或修改 Page id/provider/scope 等身份字段。 |
| `normalize` | Core 把 provider declaration 转成初始 immutable graph。 | 向 normalized protocol 加入 provider-specific 字段。 |
| `resolve graph extensions` | 为每个 normalized Page、Route、Document 解析已注册 default/config/merge/validation，并记录 namespace ownership。 | 把 callback 序列化进 graph 或改变 owner identity。 |
| `transform` | 返回 structured graph patch 和带 provenance diagnostic。 | 任意原地修改 graph。 |
| `final validation` | 每个 patch 后重新执行 identity、conflict、path-shape、target、ownership 校验。 | 通过静默丢弃 declaration 修复冲突。 |
| `contribute` | 声明 generated module/data/type 及其 semantic facet attachment。 | 写 generated file、修改已校验 identity，或执行 external side effect。 |
| `target validation` | 解析每个显式 target，并执行零匹配、多匹配、replacement cardinality 规则。 | 从 entry/output filename 猜 owner。 |
| `materialize` | Core 写入已声明 artifact，并物化 Document、Page module/activation facet、runtime hook、generic build entry。 | 把 provider semantic 放进 bundler adapter，或加入未声明 contribution。 |
| `configure adapter` | 把已校验 generic entry 与 resolution facet 投影给所选 adapter。 | 添加 Core 与 `ev inspect` 不可见的 graph semantic。 |
| lifecycle | 执行 dev middleware、build/output/deployment 工作与 cleanup。 | 隐藏本应可 inspect 的 graph semantic。 |

影响 graph 的本地项目读取必须声明为 watch input。Network call、external write、平台
mutation 属于 lifecycle，不能为更早的 deterministic phase 暗中提供事实。

## 当前可运行的 Namespaced Extension Owner

canonical 应用在顶层 `ev.config.ts` 中 author Application-owned value：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
  extensions: {
    "@company/feature": {
      enabled: true,
    },
  },
});
```

同一文件还可以配置该 Page 的唯一 semantic Route，或 Page-owned Document。
Document value 只有在该 Page 自己物化 Document 时才有效，例如 canonical MPA 或
SPA SSG：

```ts
export default definePageConfig({
  route: {
    extensions: {
      "@company/access": { policy: "canReadCheckout" },
    },
  },
  document: {
    extensions: {
      "@company/html": { theme: "checkout" },
    },
  },
});
```

显式 `application.routes` migration input 通过 Route 自己的 `extensions` 字段配置
Route，包括 componentless layout/group/redirect Route；
`application.document.extensions` 配置 Application-owned Document。这些输入最终
normalize 到相同 owner bag，不是第二套 extension 机制。

不要把这些 value 放在 `application.extensions` 下。`application` 仍只用于显式
Bigfish SPA route-tree 迁移输入。

Page-owned value 仍放在 Page 同目录的 `page.config.ts`：

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

type ApplicationFeatureValue = {
  enabled: boolean;
};

type PageFeatureValue = {
  enabled: boolean;
  channel: string;
};

export const featurePlugin = definePlugin({
  name: "feature",
  dependencies: ["another-plugin"],

  describe(api) {
    api.applicationExtension<
      ApplicationFeatureValue,
      Partial<ApplicationFeatureValue>
    >({
      namespace: "@company/feature",
      schemaVersion: "1",
      defaults: { enabled: false },
    });
    api.pageExtension<PageFeatureValue, Partial<PageFeatureValue>>({
      namespace: "@company/feature",
      schemaVersion: "1",
      defaults: { enabled: false, channel: "web" },
      merge(defaults, configured) {
        return { ...defaults, ...configured };
      },
      validate(value) {
        return value.channel.length > 0 || "channel must not be empty";
      },
    });
  },

  setup(ctx) {
    const feature = ctx.config.extensions["@company/feature"];
    // Application value 在 setup() 前已经解析并完成 deep freeze。
    console.log(feature);
  },

  contributions(ctx) {
    const applicationFeature =
      ctx.framework.applications[0]?.extensions["@company/feature"];
    const pages = ctx.framework.pages.map((page) => ({
      id: page.id,
      feature: page.extensions["@company/feature"],
    }));
    console.log(applicationFeature, pages);
  },
});
```

`definePlugin()` 是唯一 `Plugin` interface 的类型辅助函数。未提供自定义 `merge`
时，plain object 按 defaults < configured value 浅合并；其他 configured value 会
替换 defaults。Owner 未配置该 namespace 时会直接物化 defaults，不调用自定义
`merge`，因此它的 `configured` 参数始终是作者显式提供的值。defaults 函数、`merge`
和 `validate` 都是同步的。

Namespace registry 只有一份 producer contract：

- 一个插件可以为同一 namespace 的每种适用 owner 分别声明一次
  `applicationExtension()`、`pageExtension()`、`routeExtension()` 与
  `documentExtension()`；
- 重复声明同一种 owner 会报错；
- 其他插件注册同一 namespace 会冲突，即使它声明的是另一种 owner；
- 同一 namespace 的全部 owner declaration 必须使用相同的 `schemaVersion`，包括
  全部省略；
- 配置 namespace 却没有对应 owner declaration 会报错。

Application value 在 `describe()` 后、`setup()` 前解析；它在
`ctx.config.extensions` 中完成 deep freeze，随后复制到 normalized Application
extension bag。Page、Route、Document value 在 graph analysis 阶段解析，此时 owner
identity 与静态输入都已确定。Contribution view 会暴露全部四种 owner，无需读取
`.ev` internal。

所有 author value、静态 default 与 merge 后的 materialized result 都必须是严格
static JSON data。Function、Promise、symbol、bigint、非有限数字、class instance、
accessor、稀疏数组、循环引用和不安全 key 都会被拒绝。同步的 `defaults`、`merge`
与 `validate` callback 是插件 declaration 代码，不是 extension value。可执行
build-time option 应移入 plugin factory，runtime 行为应移入通过 opaque module ref
与显式 generated contribution 携带的 emitted/imported module。

canonical `page.tsx` anchor 在两种 mode 中都会提供 Page owner，显式 route-tree
迁移输入必须 normalize 到同一 graph。现有 lifecycle hook、`describe()` 与四种
extension declaration 同属一个 `Plugin` interface，并走唯一实现。不要引入历史
compatibility layer，也不要增加 `applicationExtensionV2()`、
`pageExtensionV3()` 之类名称；`schemaVersion` 只对 namespace data 做版本标记，
不是 API 版本。

Application、Page、Route、Document extension value 不会自动暴露到 runtime；
浏览器或服务端行为仍需要显式 generated runtime projection。Route/Document value
只有通过已注册 owner API 与严格静态 authoring input 才会被接受；它们不允许可执行
callback，也不会触发隐式 runtime injection。

### 当前 MPA target 行为

canonical MPA 已经暴露一个逻辑 `default` Application。在现有 generated-
contribution slot 中，Application target 会把 `client.entry` 展开到该 Application 的全部
page-client entry，并把 `html.tag` 展开到全部 Document。`page.wrapper` 按语义 Page
ownership 投影到实际存在的 client/server Page materialization，因此同一个 Application
或 Page target 可跨 SPA/MPA 使用；Page target 仍只选择一个语义 Page。这是已经落地的
行为；下一节的 semantic facet 仍是目标 API。显式 route-tree 输入必须先 normalize
到相同 ownership。

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
| `page.module` | 每个 Page definition 恰好 wrap/augment 一次，不受 SPA/MPA entry 物化方式影响。 |
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

在当前插件 API 中，在同步 `describe()` 中注册适用的 Application、Page、Route、
Document owner、default 与 merge/validation callback。顶层 Application value 在
`setup()` 前解析；canonical resolver 或显式 route-tree normalizer 随后发现
normalized owner，registry 在 graph analysis 阶段解析各 owner 的 namespaced 静态
输入，而且不能修改内部 id、source provenance、scope 等身份字段。
通用 schema 生成和有顺序的 cross-field normalizer 仍是未来工作。

显式 Bigfish migration normalizer 会把有限且有源码依据的 access/menu field
保留在内置 `@evjs/bigfish-route` Route namespace 中。其余 Bigfish 插件值与
Smallfish CAPR/Tracert/launch parameter 应分别进入已注册 namespace，不能成为
Core Page/Route node 的身份字段。

### 保留 generated artifact，改变挂载点

`emit.module`、`emit.data`、opaque ref、generated import edge 都保留，大多数 generated
source 可原样迁移。优先使用当前已支持的 contribution：

```text
global side-effect installer -> Application-targeted client.entry
Page wrapper/provider        -> page.wrapper
request middleware           -> server.request.middleware
meta/link/script/style        -> html.tag
module resolution            -> resolve.alias / resolve.external
```

Smallfish 风格 page plugin 当前已经可以在 `contributions()` 中遍历 resolved Pages 并
读取 `page.extensions`。`page.wrapper` 可以在选定 client/server projection 上组合
Page，不需要假设每个 Page 都有独立 client entry。Page activation hook、generic
`page.module` 与 per-Document bootstrap facet 仍是 planned。

### 有意识地重写 runtime plugin

旧 0.2 `client.runtime.plugin` 只 import module namespace 并记录一份 Core 从未调用
的数组。Core 0.3 不暴露这条 inert slot。迁移方式：

- side-effect installer：通过 `client.entry` 显式 import 并调用；
- root/provider 或 Page composition：能用 component wrapping 表达时使用
  `page.wrapper`；
- navigation notification 或 option transformation：typed hook 落地前，
  保持在显式 installer 或已有 public runtime API 后面。

不要复制 `patchRoutes`、`rootContainer`、`render` 等 export-name probing。注册并消费
typed `compose`、`event`、`modify` hook 是 planned contract，不是当前 API。

### 将 HTML target 改成 Document

0.2 HTML owner 从其 `app`/`page` build output 推导。Core 0.3 structured tag/AST
transform target Document id 或 selector。

- MPA Page：通常对应一个 Document；
- 静态 SPA SSG Page：对应一个 Page-owned Document；
- CSR SPA Page：没有 Page-owned Document；静态 tag target Application Document，
  随 route 变化的 metadata 使用 route/runtime head capability；
- Application：可以展开到多个 MPA Document，展开必须显式。

不要从 HTML filename 推断 target。

### Planned：用 graph patch 替代 route mutation

目标 API 会使用 normalized Page/Route declaration 与 immutable add、replace target、wrap、
patch one extension namespace 等操作。每个 patch 记录 plugin、instance、phase、dependency
order，并经过与 source provider 相同的 id/parent/path-shape/ownership 校验。

当前还没有 public graph-patch API。在它落地前，不要在 generated code 内引入第二套
route dialect；Bigfish `:id`、evjs `$id` 与 file path 仍是 provider input。

### 保持当前 Core Page rendering 合同

Core 0.3 当前在相邻 `page.config.ts` 中持有 `render`、`hydrate`、`prerender`
与 `rsc`，并在 Page view 上暴露 normalized rendering value。迁移后的插件可以读取
这些 public Page 字段，但不能根据内部 renderer entry kind 或 adapter-specific
filename 推断行为。

未来 generic rendering extension 可以持有 generic entry、request facet、
Document production、cache、streaming 与 deployment projection。这是 planned
Core 简化，不是当前 authoring contract。

## 不提供 Runtime Compatibility Adapter

Core 0.3 不通过 compatibility adapter 托管 0.2 plugin object。每个插件源码都要
迁移到唯一 `Plugin` contract。机械转换工具可以生成源码修改或 diagnostic，但不能
安装第二套 plugin runtime，也不能在应用运行时重新解释旧 hook。Extension API
同样不带版本后缀：namespace data contract 与 producer 应一起迁移，不能增加并行的
带版本后缀实现。

## 推荐迁移步骤

1. 盘点 0.2 plugin 的每个 hook、generated file、target、runtime export、route change、
   bundler mutation。
2. 将静态配置放入已注册的 Application、Page、Route 或 Document owner，并分别
   定义 default/merge/validation。Page、唯一 Route、Page-owned Document 使用
   canonical `page.config.ts`；显式 migration input 可以配置它声明的 Route 与
   Application-owned Document。不要把 value 放到 normalized graph 中不存在的
   owner。
3. 为每个 generated artifact 选择当前 structured contribution 或 lifecycle hook，
   标出所有依赖 entry name/HTML filename 的 target；需要 planned facet 的缺口单独记录，
   不把它描述成当前 API。
4. 将 raw config、当前 generated contribution declaration、materialization、
   side-effect lifecycle 拆入对应 phase。Plugin graph transform 仍为 planned。
5. 用显式 installer 与当前 structured contribution 替换 runtime side
   effect/export probing；typed hook API 落地后再使用。
6. 移除 Page URL、Document、entry、render mode 一对一假设。
7. 在一份 SPA 和一份 MPA graph 上测试，即使插件有意拒绝其中一种 routing mode。
8. 检查 `.ev` 中的 producer、target expansion、generated import、conflict order。

## 迁移插件的必测项

- schema default 与 invalid config diagnostic；
- Application extension 在 `setup()` 前解析，Page/Route/Document extension 在
  normalized graph 上解析；
- duplicate-owner、跨插件 namespace、跨 owner `schemaVersion` 冲突 diagnostic；
- required/optional dependency 的 deterministic ordering；
- SPA/MPA 中 `page.wrapper` 都对每个选定 Page projection 恰好生效一次；
- Application contribution 在 SPA 一次、MPA 所有目标 entries/Documents 中正确展开；
- Document HTML contribution 不泄漏、不重复；
- zero-match target 和 multiple replacement diagnostic；
- generated module import edge 与 watch input；
- 显式 installer 行为与 reverse-order lifecycle cleanup；
- Webpack/Utoopack 消费同一 semantic BuildPlan；
- `ev inspect` 显示 plugin、resolved owner、contribution、materialized
  entry/Document；
- rendering-sensitive 行为读取 public normalized Page 字段，而不是内部 renderer
  entry kind。

Graph transform、typed runtime hook 与 generic semantic facet 落地后，需要另行补充
patch provenance、hook ordering 与 facet cardinality 测试；这些未来测试不是当前迁移
gate。
