# Qiankun 插件

`@evjs/plugin-qiankun` 让 evjs 单页应用参与
[qiankun](https://github.com/umijs/qiankun) 主/子应用微前端拓扑。它只做协议桥接：
包装当前配置的 app entry、接入 qiankun lifecycle，并加载用户提供的 resolver/runtime
模块。它不拥有应用路由、平台站点元数据、部署字段或本地研发代理约定。

当 SPA 应用明确以 qiankun master 或 slave 身份运行时再启用这个插件。默认路径是
canonical Page-and-Route SPA 模型。不要把它用于 MPA 应用。

## 安装

```bash
npm install @evjs/plugin-qiankun qiankun
```

## Master 应用

Master 应用注册子应用并启动 qiankun。使用 `evPluginQiankunMaster()` 配置插件，
并提供 resolver 模块：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

resolver 返回 qiankun 应用列表与 qiankun framework options，这些字段保持扁平：

```ts
// src/qiankun.master.ts
import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunMasterResolver(async () => ({
  apps: [
    {
      name: "catalog",
      entry: "//localhost:3001",
      container: "#slave-container",
    },
  ],
  sandbox: true,
  prefetch: true,
}));
```

canonical Route 在 `page.tsx` 锚点旁持有 micro-app 关联：

```ts
// src/pages/catalog/page.config.ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  route: {
    extensions: {
      "@evjs/qiankun": {
        microApp: "catalog",
      },
    },
  },
});
```

master 插件通过 `routeExtension()` 注册该 namespace，校验它指向静态 Page Route，
并从 normalized CoreGraph 生成 qiankun route mapping。app 未显式设置
`activeRule` 时，插件在调用 `registerMicroApps` 时使用这份 mapping。
resolver-level `routes` 数组只作为显式 resolver 输入；canonical path 不应在那里重复
声明。

Master 运行期间应由 shell 稳定提供 qiankun container；如果希望 container 跟随
路由组件挂载，应由上层插件把 route 转换成 micro-app 组件。

```tsx
// src/pages/layout.tsx
import { Link } from "@evjs/ev/navigation";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <main>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/catalog">Catalog</Link>
      </nav>
      {children}
      <section id="slave-container" />
    </main>
  );
}
```

```tsx
// src/pages/catalog/page.tsx
export default function CatalogPage() {
  return <h1>Catalog workspace</h1>;
}
```

## Slave 应用

Slave 应用向 master 暴露 qiankun lifecycle，同时在非 qiankun 环境下仍能独立渲染。
使用 `evPluginQiankunSlave()`：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunSlave } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    evPluginQiankunSlave({
      name: "catalog",
      runtime: "./src/qiankun.slave.ts",
    }),
  ],
});
```

应用仍然是普通 canonical Page 应用：

```tsx
// src/components/CatalogApp.tsx
export function CatalogApp() {
  return <h1>Catalog</h1>;
}
```

`src/pages/page.tsx` 与 `src/pages/catalog/page.tsx` 都可以 default-export
这个共享 UI。两个目录分别发布 standalone `/` 与供 master 激活的 `/catalog`，
不需要第二份 route declaration。

runtime 模块只用于扩展 lifecycle。如果应用不需要额外行为，可以不提供 runtime：

```ts
// src/qiankun.slave.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props, ctx) {
    console.log(`${ctx.name} mounted`, props.container);
  },
  unmount() {
    console.log("slave unmounted");
  },
});
```

在 qiankun 环境中，插件会挂载到 `props.container`；在非 qiankun 环境中会自动
渲染 canonical framework entry。插件不支持另一套 entry 字段，也不会推断 magic
`src/main.tsx`。Standalone `@evjs/client` 应用自行持有 qiankun/container
集成。

## 模块引用

`resolver` 和 `runtime` 支持字符串模块引用、generated module ref，也支持带 named
export 的对象引用：

```ts
import type { GeneratedModuleRef } from "@evjs/ev/plugin";

type QiankunModuleRef =
  | string
  | GeneratedModuleRef
  | {
      module: string | GeneratedModuleRef;
      exportName?: string;
    };
```

字符串引用读取 default export：

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
});
```

对象引用适合 named export：

```ts
evPluginQiankunSlave({
  runtime: {
    module: "/absolute/path/to/generated-slave-runtime.ts",
    exportName: "runtime",
  },
});
```

路径类引用会先基于项目根目录解析，再进入 bundling，因此生成的 entry wrapper
不会保留未解析的 `./src/...` specifier。包名 specifier 则按项目依赖正常解析。
在另一个插件的 `contributions()` hook 中，可以把 `ctx.emit.module()` 返回的
`GeneratedModuleRef` 直接传给 `contributeQiankunMaster()` 或
`contributeQiankunSlave()`。

## Runtime 形态

Master resolver 返回：

```ts
interface QiankunMasterOptions {
  apps?: QiankunApp[];
  routes?: Array<{ path: string; microApp: string }>;
  appNameKeyAlias?: string;
  sandbox?: boolean | Record<string, unknown>;
  prefetch?: boolean | string[] | ((apps: QiankunApp[]) => unknown);
  singular?: boolean | ((app: QiankunApp) => Promise<boolean>);
  fetch?: typeof globalThis.fetch;
  [key: string]: unknown;
}
```

`apps`、`routes` 和 qiankun options 在同一层级，没有 `framework` 包裹。除
`apps`、`routes`、`appNameKeyAlias` 外，其他字段会传给 `qiankun.start()`。

Slave runtime 可扩展以下 lifecycle：

```ts
interface QiankunSlaveRuntime {
  bootstrap?(props, ctx): void | Promise<void>;
  mount?(props, ctx): void | Promise<void>;
  unmount?(props, ctx): void | Promise<void>;
  update?(props, ctx): void | Promise<void>;
}
```

`ctx.loadEntry()` 会加载原始 app entry。内置 slave lifecycle 会在可选 runtime
`mount()` hook 执行后，于 `mount()` 阶段调用它。生成的原始 entry 在 lifecycle
调用其导出的 `start(container)` 前不会自行挂载，因此即使在 `bootstrap()` 中提前
加载，也不会误挂到 master document。首次 `mount()` 通过 `start()` 保留 hydration
marker 语义；模块本身会被缓存，后续重新挂载只会在当前 qiankun container 内调用
一次 `app.render()`。

## Qiankun 打包方式

默认情况下，qiankun 会进入应用 bundle：

```ts
evPluginQiankunMaster({
  resolver: "./src/qiankun.master.ts",
  externalQiankun: false,
});
```

如果部署环境提供了外置 qiankun，可以设置 `externalQiankun: true`：

```ts
evPluginQiankunSlave({
  name: "catalog",
  externalQiankun: true,
});
```

## 本地开发

插件不内置本地研发代理。如果 master 需要通过同源路径加载 slave dev server，
请在 master 应用的 `dev.proxy` 中配置：

```ts
// master 应用的 ev.config.ts
import { defineConfig } from "@evjs/ev";
import { evPluginQiankunMaster } from "@evjs/plugin-qiankun";

export default defineConfig({
  routing: { mode: "spa" },
  dev: {
    port: 3000,
    proxy: [
      {
        context: ["/__qiankun_slave"],
        target: "http://localhost:3001",
        pathRewrite: {
          "^/__qiankun_slave": "",
        },
        changeOrigin: true,
        secure: false,
      },
    ],
  },
  plugins: [
    evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    }),
  ],
});
```

resolver 指向代理后的 HTML entry。qiankun 3 消费的是 HTML entry URL，不再是
`{ scripts, styles, html }` 对象。`evPluginQiankunSlave()` 会为 qiankun 3 标记产物
HTML 中的 entry script，并把生成的根路径 JS/CSS 资源 URL 改成相对 URL，因此同一份
slave HTML 可以挂在 `/__qiankun_slave` 这样的路径前缀下被 master 消费：

```ts
const slaveBase = "/__qiankun_slave";

export default async function resolveQiankunMaster() {
  return {
    apps: [
      {
        name: "catalog",
        entry: new URL(`${slaveBase}/index.html`, window.location.href).href,
        container: "#slave-container",
      },
    ],
    sandbox: true,
    prefetch: true,
  };
}
```

`/catalog` 关联仍来自
`src/pages/catalog/page.config.ts#route.extensions`，resolver 不重复声明路径。

请把这类代理放在 `dev.proxy`，不要放进 `src/apis`；应用 API routes 不应该承担
微前端资产代理职责。

## 在平台插件上扩展

大型组织通常会在 qiankun 之上有一层微前端平台：站点配置服务、部署侧应用身份、
默认 sandbox 规则、路由映射约定，或平台专属 mount props。请把这些平台逻辑留在
`@evjs/plugin-qiankun` 外部。

推荐分层是组合：

- `@evjs/plugin-qiankun` 负责 qiankun 协议桥接。
- 平台插件负责平台元数据、生成 resolver/runtime 模块、默认 dev proxy 规则和部署约定。
- 业务应用消费平台插件，通常不需要手写 `src/qiankun.master.ts` 或
  `src/qiankun.slave.ts`。

平台 master 插件可以把 resolver 模块 emit 到同一个 `.ev` IR 中，再把返回的 opaque
ref 传给 qiankun helper：

```ts
// packages/plugin-platform/src/master.ts
import { merge } from "@evjs/ev/config";
import type { Plugin } from "@evjs/ev/plugin";
import {
  contributeQiankunMaster,
  QIANKUN_ROUTE_EXTENSION_NAMESPACE,
} from "@evjs/plugin-qiankun";

export function evPluginPlatformMicroFrontendMaster(): Plugin {
  return {
    name: "@acme/evjs-platform-mf:master",
    describe(api) {
      api.routeExtension({
        namespace: QIANKUN_ROUTE_EXTENSION_NAMESPACE,
      });
    },
    config(config) {
      merge(config, {
        dev: {
          proxy: [
            ...(config.dev?.proxy ?? []),
            {
              context: ["/__platform_slave"],
              target: "http://localhost:3001",
              pathRewrite: { "^/__platform_slave": "" },
              changeOrigin: true,
              secure: false,
            },
          ],
        },
      });
      return config;
    },
    async contributions(ctx) {
      const site = ctx.emit.data({
        id: "platform-site",
        scope: { kind: "application" },
        value: await loadPlatformSiteConfig(ctx),
      });

      const resolver = ctx.emit.module({
        id: "master-resolver",
        scope: { kind: "application" },
        source: ({ importOf }) => `
          import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";
          import site from ${JSON.stringify(importOf(site))};

          export default defineQiankunMasterResolver(async () => ({
            apps: site.children,
            sandbox: site.sandbox ?? true,
            prefetch: site.prefetch ?? true,
          }));
        `,
      });

      await contributeQiankunMaster(ctx, {
        resolver,
        externalQiankun: true,
      });
    },
  };
}
```

`merge()` 会替换数组，因此平台插件追加代理时必须像上面一样复制已有
`config.dev.proxy`。这样应用配置及更早插件注册的代理规则不会被覆盖。

生成的 resolver 把平台应用元数据适配为开源 qiankun resolver 形态。canonical route
关联仍位于 Page-local `route.extensions`；注册共享 namespace 后，
`contributeQiankunMaster()` 会投影它们。resolver 仍是带 manifest provenance 的
generated artifact，而不是未受管理的临时文件：

```ts
import { defineQiankunMasterResolver } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunMasterResolver(async () => {
  const site = await loadPlatformSiteConfig();

  return {
    apps: site.children.map((child) => ({
      name: child.name,
      entry: child.entry,
      container: child.container,
      props: child.props,
    })),
    sandbox: site.sandbox ?? true,
    prefetch: site.prefetch ?? true,
  };
});
```

平台 slave 插件可以 emit runtime module，把它传给 qiankun contribution helper，并复用
qiankun 的 bundler 和 HTML helper：

```ts
// packages/plugin-platform/src/slave.ts
import type { Plugin } from "@evjs/ev/plugin";
import {
  applyQiankunSlaveBundlerConfig,
  applyQiankunSlaveHtmlTransform,
  contributeQiankunSlave,
  type QiankunContributionState,
} from "@evjs/plugin-qiankun";

export function evPluginPlatformMicroFrontendSlave(): Plugin {
  let qiankunState: QiankunContributionState | undefined;

  return {
    name: "@acme/evjs-platform-mf:slave",
    async contributions(ctx) {
      const runtime = ctx.emit.module({
        id: "slave-runtime",
        scope: { kind: "application" },
        source: `
          import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

          export default defineQiankunSlaveRuntime({
            mount(props) {
              const platformProps = normalizePlatformProps(props);
              Reflect.set(globalThis, "__PLATFORM_MICRO_FRONTEND_PROPS__", platformProps);
            },
            unmount() {
              Reflect.deleteProperty(globalThis, "__PLATFORM_MICRO_FRONTEND_PROPS__");
            },
          });
        `,
      });

      qiankunState = await contributeQiankunSlave(ctx, {
        name: inferPlatformAppName(ctx),
        runtime,
        externalQiankun: true,
      });
    },
    setup() {
      return {
        bundlerConfig(config, ctx) {
          applyQiankunSlaveBundlerConfig(config, ctx.bundlerName, qiankunState);
        },
        transformHtml(doc) {
          applyQiankunSlaveHtmlTransform(doc, qiankunState);
        },
      };
    },
  };
}
```

`contributeQiankunSlave()` 返回的 state 保证 generated entry、bundler 产物和
lifecycle proxy 使用同一个推导出的应用名。如果明确使用默认的
`evjs-qiankun-slave` 名称，也可以不向 `applyQiankunSlaveHtmlTransform()` 传 state。

生成的 slave runtime 可在业务代码观察 props 之前统一平台专属 mount props：

```ts
// generated-slave-runtime.ts
import { defineQiankunSlaveRuntime } from "@evjs/plugin-qiankun/runtime";

export default defineQiankunSlaveRuntime({
  mount(props) {
    const platformProps = normalizePlatformProps(props);
    Reflect.set(globalThis, "__PLATFORM_MICRO_FRONTEND_PROPS__", platformProps);
  },
  unmount() {
    Reflect.deleteProperty(globalThis, "__PLATFORM_MICRO_FRONTEND_PROPS__");
  },
});
```

这样可以保持开源插件稳定、可复用，同时让平台插件在边界处把内部站点配置、应用身份、
别名、路由约定和部署默认值映射到 qiankun 协议。

## 边界

`@evjs/plugin-qiankun` 包含：

- master 和 slave app-entry 包装；
- resolver/runtime 模块加载；
- qiankun lifecycle 导出；
- slave standalone 渲染；
- `externalQiankun` bundler external 支持；
- resolver/runtime 模块的 TypeScript helper。

它不包含：

- 平台专属站点配置协议；
- 组织内部应用身份字段；
- 部署元数据或发布平台字段；
- 本地开发 HTML 改写服务；
- 自动 master proxy 生成；
- 除 route 到 `activeRule` 映射以外的额外路由语义。
