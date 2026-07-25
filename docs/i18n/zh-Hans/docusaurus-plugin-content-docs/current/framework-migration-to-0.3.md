# Bigfish、Smallfish 迁移到 Core 0.3

本文记录 Bigfish、Smallfish 应用与插件迁往 evjs Core 0.3 的源码事实和迁移契约。
它是一份能力映射，不是兼容模式规范。

## 源码审计基线

以下结论来自这些源码快照：

| 框架 | 源码 revision | 包版本基线 |
| --- | --- | --- |
| Bigfish | `dcdd27c5dcd71cd0cd7ed9659dfce07f7923f7a7` | `@alipay/bigfish` `4.5.55`，Umi/Max `4.6.51` |
| Smallfish | `cda767b734c114c555691eaac568ed1a5c1e33d5` | Core/runtime/plugin 包 `2.96.11` |

审计会区分框架行为与周边生态包。OneAPI、Bakery、CAPR、HD、Tracert、
Tern、UBOA、离线包以及部署平台集成是 Core 机制的迁移消费者，不是新的内置
路由模型。

## 约束设计的源码事实

### Bigfish 只支持 SPA

Bigfish 的受支持 Application 模型是一棵 SPA route tree。`site` 应用类型是在这棵
SPA 上开启静态导出，不是 Bigfish MPA。Umi 依赖层虽然存在实验性 MPA 代码，但
Bigfish 没有把它作为受支持的应用类型暴露、适配和验证。

因此 Bigfish 只有两条 Core 0.3 入口：

- 临时使用仅支持 SPA 的 `application.routes` 迁移输入；
- 使用 canonical Page tree 与 `routing.mode: "spa"`。

不存在 `Bigfish MPA` 迁移通道。

### Bigfish Route 与 Page 身份不同

显式 route tree 是 Bigfish 的主要应用结构。Route 可以指向 Page，也可以是
redirect、pathless group、layout 或 wrapper。同一个 component 可以被多条 Route
引用，没有 component 的 Route 也可以携带插件数据。

Umi route normalization 会保留额外 route property，现有插件会消费这些
Route-owned 数据：

- 权限：`access`；
- layout/menu：`name`、`title`、`icon`、`flatMenu`；
- qiankun：`microApp`、`microAppProps`；
- BOP：`menuKey`、`menuAssetOptions`；
- 埋点：`spmBPos`。

这些值不能坍缩到 Page config。Core 0.3 使用同一套 namespaced extension registry，
由 Route owner 承载插件路由数据。Core route 结构仍然显式且经过校验；注册的
extension 不会变成无类型 metadata bag。

### Smallfish 是 Page-entry MPA

Smallfish 发现 Pages 目录的直接子级，选择 `index.{tsx,ts,jsx,js}`，读取相邻
`config.json`，为每个 Page 创建一个 Page instance、一个 client entry 和一个
HTML output，再由插件贡献 Page-scoped 构建行为。

Smallfish Page 目录本身已提供有价值的 private-code scope。迁移只改变正向锚点，
不会丢掉这个 ownership：

```text
src/pages/checkout/
├── index.tsx       -> page.tsx
├── config.json     -> page.config.ts
├── model.ts
└── components/
```

Smallfish 默认输出 `<name>.html`。`router` 可以指定
`shop/checkout.html` 这样的嵌套输出，也可以包含由 Smallfish runtime rewrite 的
动态 `:param`。这些输出与请求改写语义，不能只通过文件重命名等价为 evjs 的
目录派生 URL。迁移必须通过通用 Document 能力物化经过校验的 output mapping，
否则就把该 URL 报告为显式 blocker；不能静默改变已发布 URL。

### 两个源框架都不要求延迟 hydration mode

Bigfish、Smallfish 使用普通 CSR mount，或对服务端 markup 立即 hydrate。源码
没有把 `visible`、`idle` 建立为迁移需求，因此 Core Page config 只保留
`"none" | "load"`。

## 一个目标模型

两个框架最终都归一到以下 semantic owner：

| Owner | 稳定语义 | Bigfish 来源映射 | Smallfish 来源映射 |
| --- | --- | --- | --- |
| Application | 逻辑 browser/server application 与共享配置 | SPA application | 所有 MPA entry 的逻辑 owner |
| Page | component source、rendering policy 与 private source scope | source normalize 后的 route component | Page instance/directory |
| Route | URL pattern、父子关系、target、layout/wrapper facet 与 Route-owned 插件数据 | 显式 route node | 目录派生 semantic URL |
| Document | HTML template、mount、output 与 bootstrap owner | SPA application shell 或静态导出 document | 每个 Page 的 HTML output |

Canonical 应用源码只有一种约定：

```text
src/pages/**/page.{ts,tsx,js,jsx}
```

所在目录决定 Page scope 与 URL。相邻 `page.config.ts` 承载构建期 Page title、
named metadata、rendering 设置和 Page-owned 插件 extension。`routing.mode` 只
选择 SPA 或 MPA 物化，不选择另一种 discovery 方言。

Core 0.3 明确不提供：

- `compatibility.source`；
- 带版本后缀的 graph 或 plugin API；
- `index.*` fallback reader；
- 分子系统的 convention 关闭开关；
- `config.json` runtime reader；
- Bigfish/Smallfish hook 名模拟器。

## 应用迁移矩阵

| 源能力 | Core 0.3 目标 | 迁移处理 |
| --- | --- | --- |
| Bigfish 显式嵌套路由 | `application.routes` SPA migration input，随后迁入 canonical Page tree | 把 `routes`、`component`、redirect、layout、wrapper normalize 到同一 CoreGraph；源码完成转换后删除 migration input |
| Bigfish 额外 route props | 已注册 Route extension | 每个插件把自己的字段移入独立 namespace；不复制任意未知 key |
| Bigfish Page/group private 目录 | Canonical Page directory scope | 每个已发布 component 移到 URL 对应目录并使用 `page.tsx`；colocated source 无需 `_` 也保持 private |
| Bigfish 全局 layout/runtime provider | Application layout、`page.wrapper` 与 `client.entry` contribution | 保留语义化 composition 与显式 runtime installer |
| Bigfish site/static export | SPA Page 的显式 prerender/rendering 设置 | 不翻译成 MPA |
| Smallfish direct-child Page | MPA mode 下的 canonical recursive Page tree | 一次性把 `index.*` 源码迁为 `page.*` |
| Smallfish `config.json` title/meta | Core `page.config.ts` 的 `title`/`meta` | 生成静态 typed config，并移除 JSON reader |
| Smallfish 插件持有 Page config | 已注册 Page extension | owner plugin 定义 defaults、merge、validation 与 runtime/build projection |
| Smallfish `<name>.html`/自定义 `router` | Document output mapping 与 request/deployment projection | 可表达时保留静态映射；动态 rewrite 由选定 adapter 显式承接前必须诊断 |
| evjs 0.2 `_private` 约定 | Canonical Page directory scope | `_` 可以保留为普通文件名，但不再是 discovery 的必要条件 |

## 插件能力矩阵

源框架暴露了大量 hook 名，但行为可以收敛为更少的语义阶段：

| 源行为 | Core 0.3 机制 | 边界 |
| --- | --- | --- |
| Config schema、defaults、validation | `describe()` 与已注册 Application/Page/Route/Document extension | Extension value 必须是严格静态 JSON；可执行 options 留在 plugin factory |
| 会影响 discovery 的 config normalize | 有序 `config()` hook | 结果必须通过唯一 framework config resolver |
| Generated/tmp module 与 data | `.ev` generated module/data、opaque ref 与 import edge | 插件声明 artifact，不任意写 framework tmp file |
| Entry import 与 runtime plugin | 带显式 installer module 的 `client.entry` | 不提供 inert runtime-plugin registry，也不猜 export 名 |
| Page provider/component transform | `page.wrapper` | 跨受支持 client/server projection 定位 semantic Page |
| Route/menu/access/tracing data | 已注册 Route extension 加显式 generated runtime projection | 包括 componentless Route，Route 数据仍由 Route 持有 |
| Head script/style/link 与 HTML mutation | 结构化 `html.tag` 与有序 `transformHtml()` | 定位 Document/owner，不从文件名推断 |
| Request middleware | `server.request.middleware` | 产品 endpoint 与平台协议仍是显式 plugin/server 能力 |
| Alias/external rule | `resolve.alias` 与 `resolve.external` | Adapter projection 会按 runtime capability 校验 |
| Bundler-specific transform | typed adapter `bundlerConfig()` escape hatch | 只在 BuildPlan/structured contribution 无法表达时使用 |
| Build/deployment output | `buildOutput()`、`buildEnd()` 与 canonical deployment metadata | 平台包消费 build facts，不重新推导 route ownership |
| Watch 与 cleanup | `addWatchFile()` 与逆序 `dispose()` | rebuild 创建新的 deterministic resolution session |

Bigfish 仓库内置和仓库内插件最常使用 check、config transform、generated file、
build complete、HTML、runtime plugin injection 与 bundler 修改。Smallfish 第一方
生态最常使用 config/Page schema hook、Application generated file、Page entry
import、HTML hook、Page resolved callback、alias/global 与 bundler 修改。因此
generated artifact、四种 graph owner、Document targeting、确定性 lifecycle 与
adapter escape hatch 是 Core 机制，而不是框架专属兼容 API。

支撑上述优先级的机械源码统计是保守下限。Bigfish tracked `src/**` 与仓库内
`plugins/**` 一共匹配 160 个 hook 调用点，其中最大几组是：

| Bigfish hook | 调用点 |
| --- | ---: |
| `onCheckCode` / `onCheckPkgJSON` | 18 / 15 |
| `modifyDefaultConfig` / `modifyConfig` | 14 / 10 |
| `onGenerateFiles` | 12 |
| `onCheckConfig` / `onCheck` | 10 / 8 |
| `onBuildComplete` | 9 |
| `addHTMLHeadScripts` / `modifyHTML` | 7 / 6 |
| `onDevCompileDone` / `onStart` | 6 / 5 |
| `addRuntimePlugin` | 5 |
| `chainWebpack` | 4 |

Smallfish 第一方生产源码的代表性调用点统计如下：

| Smallfish 行为 | 调用点 |
| --- | ---: |
| `describeConfig` / `describePageConfig` | 43 / 8 |
| Application `addTmpFile` | 19 |
| `addEntryImportsAhead` / `addEntryImports` | 11 / 4 |
| `addHTMLHeadScripts` / `addHTMLScripts` / `addHTMLMetas` | 9 / 5 / 3 |
| `onPagesResolved` | 7 |
| `defineModuleAlias` / `addGlobalVariable` | 6 / 6 |
| `chainWebpack` | 5 |

统计不包含 transitive package 与仓库外发布插件，因此它证明优先级，不代表完整
兼容百分比。

## Extension ownership 与可执行行为

一个插件 namespace 可以声明它实际支持的 owner：

```ts
definePlugin({
  name: "@company/access",
  describe(api) {
    api.applicationExtension({
      namespace: "@company/access",
      defaults: { enabled: true },
    });
    api.pageExtension({
      namespace: "@company/access",
      defaults: { role: "guest" },
    });
    api.routeExtension({
      namespace: "@company/access",
      defaults: { permission: null },
    });
  },
});
```

每种 owner declaration 属于同一个 namespace producer 与 schema version。值会在
contribution code 消费前完成 clone、validate 与 freeze。Route extension 可以区分
指向同一 Page 的两条 Route，也能存在于 redirect/group 上，不需要伪造 Page。

Function、component、installer、middleware 与平台 client 不是 extension value。
它们仍以 module reference 形式连接到 structured contribution 或 lifecycle hook。
这样旧插件可以逐项迁移能力，而无需把可执行代码序列化进 CoreGraph。

## Bigfish 应用迁移顺序

1. 记录当前 route tree、Route-only property、wrapper、redirect、公开 path，以及
   每个读取或修改 Route 的插件。
2. 临时把显式 tree 保留在仅支持 SPA 的 `application.routes`。
3. 注册每个插件的 Route namespace，把字段移入 `route.extensions`；Route 顶层
   只保留 Core 结构字段。
4. 把每个 Page component 移入 canonical URL 对应目录，正向 entry 改名为
   `page.*`。
5. Document title/metadata 移入 `page.config.ts`；menu label、permission、
   tracing、micro-frontend selection 留在 Route extension。
6. 把 generated tmp file/runtime-plugin registration 改写为 `.ev` artifact、
   explicit installer、wrapper、HTML/resolve contribution。
7. 使用 `ev inspect` 与集成测试对比 normalized Route、runtime 行为、HTML、静态
   output 与 deployment metadata。
8. 删除 `application`，用 `routing.mode: "spa"` 启用 canonical tree。

如果一个 component 确实发布在多个 URL，为每个 URL 创建复用共享 component 的
薄 canonical Page module。这样无需复制业务实现，也能保持每个 canonical URL 有
一个明确 Page owner。

## Smallfish 应用迁移顺序

1. 盘点每个 Page directory、显式 `pages` item、自定义 entry/root、
   `config.json`、`router`、HTML layout、mount、output filename 和
   Page-scoped plugin field。
2. 先以 check mode 运行一次性迁移，并审核每个 rename 与 config conversion。

   ```bash
   # 默认只做 dry-run。
   ev migrate smallfish

   # 输出机器可读的 dry-run 结果，便于 CI 或脚本审核。
   ev migrate smallfish --json

   # appBaseDir/pagesDir 自定义时，传入已解析后的目录。
   ev migrate smallfish --pages-dir app/screens

   # 仅在全局 preflight 通过后执行写入。
   ev migrate smallfish --write
   ```

   命令会先检查全部 Page，任何错误都会阻止所有写入。生成的薄 anchor 和 Page
   config 都带有迁移 marker，因此已完成迁移后再次执行会成为 no-op。
   Smallfish 的 `src/pages/index/index.*` 会保留为 private implementation，
   再由生成的根 `src/pages/page.*` 薄 re-export 暴露，避免误发布成 `/index`。
   项目配置永远不会被执行或 import：只有直接导出 object literal 的配置才能
   自动完成静态验证。对象简写、spread、computed property、函数式配置以及
   import 或其他间接配置都会作为 blocker。
3. 把被选中的 `index.*` entry 改名为 `page.*`，其余 colocated file 原地保留。
4. 命令只为支持的 title/named metadata 生成 `page.config.ts`。插件持有的静态
   字段必须手工移入已注册 namespace；命令会阻止未知字段，不会猜测其 owner
   或映射方式。
5. 通过 Document/output 机制保留每个已发布静态 HTML filename。迁移命令会把
   静态 `<name>.html` 或带有严格 `.html`/`.htm` 后缀的安全 `router` 值写入
   `document.aliases`；alias 是同一个 transformed Document 的额外输出，不会
   创建第二条 Route 或第二个 Page。动态 `:param` rewrite、alias/output 冲突、
   显式 `pages` declaration、自定义 Nunjucks 逻辑、非 HTML 输出后缀和不受支持
   的可执行配置必须作为 blocker，由显式 adapter 或源码改写处理。
6. 把 Application/Page generated file、entry import、HTML hook 和 deployment
   逻辑迁到 structured plugin contribution。
7. 只配置 `routing.mode: "mpa"`，逐个验证原始 request URL 与 emitted output；
   不添加 Smallfish source switch。

显式 Smallfish `pages` declaration 可以把相同 root/entry 暴露为多个公开 Page。
Canonical source 用 import 共享实现的薄 Page anchor 表达，不引入第二个 Page
config reader。

## 验证契约

只有相关行都有证据时，应用迁移才算完成：

- 每个已发布 URL 都映射到预期 normalized Route；
- 每个 Page 只有一个正向 `page.*` anchor，并具有预期 private scope；
- title、named metadata、mount、template 与 output filename 一致；
- Bigfish redirect/group 与 Smallfish per-Page Document 保持不同 owner；
- 每个 plugin namespace 都为实际 authoring owner 完成注册；
- `.ev` 中可以检查 generated module 与 import edge；
- runtime installer、Page wrapper、middleware、HTML transform 按确定顺序执行一次；
- 插件支持两个 mode 时，同时覆盖 SPA 与 MPA 测试；
- `ev inspect`、build output 与 deployment metadata 一致；
- 不受支持的源行为产生 migration diagnostic，而不是被忽略。

## 源码证据索引

审计使用的代表性源码位置：

| 框架 | 源码区域 | 证据 |
| --- | --- | --- |
| Bigfish | `src/appType/appType.ts`、`src/appType/site.ts` | 受支持 application type；`site` 开启静态导出 |
| Bigfish | `src/constraint/rules/ROUTE_NO_CONVENTIONAL.ts` | 显式 route config 是受支持 Bigfish 结构 |
| Bigfish/Umi | `@umijs/core/dist/route/routesConfig.js` | Route normalize、nesting、path 行为与 route prop 保留 |
| Bigfish | `plugins/preset-bop/src/subapp/subapp.ts` | Route mutation、`menuKey`/`menuAssetOptions`、generated file 与 runtime plugin |
| Bigfish | `src/ctoken`、`src/tern`、`src/deployMode` | Generated file、runtime plugin、HTML/build/deployment hook |
| Smallfish | `packages/smallfish-core/src/kernel/main.ts`（`resolvePages`） | Direct-child/explicit Page discovery 与 Page instance 创建 |
| Smallfish | `packages/smallfish-core/src/kernel/instance/page.ts` | 默认 `<name>.html`、自定义 `router`、entry 与 Page output ownership |
| Smallfish | `packages/smallfish-types/src/core/config/page.ts` | 包含 `router`、`htmlFileExtension` 的 Page config contract |
| Smallfish | `packages/smallfish-core/src/kernel/plugin/context/activate.ts` | Page entry、HTML、Page resolution 与 plugin activation hook |
| Smallfish | `packages/smallfish-plugin-app/src` | Application tmp file、Page entry import、HTML、runtime、deployment consumer |
| Smallfish | `packages/smallfish-runtime/src/utils.ts` | 动态 `router` 参数恢复 |

文首源码 revision 是证据的一部分。扩展兼容范围前，应针对新的上游版本重新审计。
