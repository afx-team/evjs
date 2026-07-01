const path = require("node:path");

const originalQuery = "evjs-qiankun-original";

module.exports = function qiankunEntryLoader() {
  this.cacheable?.();
  const options = this.getOptions ? this.getOptions() : {};
  const loaderContext = {
    resourcePath: this.resourcePath,
    rootContext: this.rootContext,
  };
  const originalEntry = createOriginalEntryRequest(loaderContext);
  const qiankunRuntime = toModuleRequest(
    requiredString(options.qiankunRuntime, "qiankun runtime"),
    loaderContext,
  );

  if (options.role === "master") {
    return [
      `import * as masterResolverModule from ${JSON.stringify(toModuleRequest(requiredString(options.resolver, "resolver"), loaderContext))};`,
      `import ${JSON.stringify(originalEntry)};`,
      `import { resolveQiankunModuleExport, startQiankunMaster } from ${JSON.stringify(qiankunRuntime)};`,
      ``,
      `const masterResolver = resolveQiankunModuleExport(`,
      `  masterResolverModule,`,
      `  ${JSON.stringify(options.resolverExport || "default")},`,
      `  "qiankun master resolver",`,
      `);`,
      ``,
      `void startQiankunMaster(masterResolver);`,
      ``,
    ].join("\n");
  }

  if (options.role === "slave") {
    const runtimeImport = options.runtime
      ? `import * as slaveRuntimeModule from ${JSON.stringify(toModuleRequest(options.runtime, loaderContext))};`
      : "";
    const runtimeValue = options.runtime
      ? [
          `const slaveRuntime = resolveQiankunModuleExport(`,
          `  slaveRuntimeModule,`,
          `  ${JSON.stringify(options.runtimeExport || "default")},`,
          `  "qiankun slave runtime",`,
          `);`,
        ].join("\n")
      : `const slaveRuntime = {};`;

    return [
      runtimeImport,
      `import { createQiankunSlaveLifecycles, resolveQiankunModuleExport } from ${JSON.stringify(qiankunRuntime)};`,
      ``,
      runtimeValue,
      ``,
      `const qiankunSlave = createQiankunSlaveLifecycles({`,
      `  name: ${JSON.stringify(options.name || "evjs-qiankun-slave")},`,
      `  mount: ${JSON.stringify(options.mount || "#app")},`,
      `  runtime: slaveRuntime,`,
      `  loadEntry: () => import(${JSON.stringify(originalEntry)}),`,
      `});`,
      ``,
      `export const bootstrap = qiankunSlave.bootstrap;`,
      `export const mount = qiankunSlave.mount;`,
      `export const unmount = qiankunSlave.unmount;`,
      `export const update = qiankunSlave.update;`,
      ``,
      `if (!qiankunSlave.isPoweredByQiankun()) {`,
      `  void qiankunSlave.standalone();`,
      `}`,
      ``,
    ]
      .filter(Boolean)
      .join("\n");
  }

  throw new Error(
    `[evjs:plugin-qiankun] Unknown qiankun entry loader role "${options.role}".`,
  );
};

function createOriginalEntryRequest(loaderContext) {
  const resourcePath = loaderContext.resourcePath;
  if (typeof resourcePath !== "string" || resourcePath.trim() === "") {
    throw new Error(
      "[evjs:plugin-qiankun] qiankun entry loader requires a resource path.",
    );
  }
  return `${toModuleRequest(resourcePath, loaderContext)}?${originalQuery}`;
}

function toModuleRequest(specifier, loaderContext) {
  if (typeof specifier !== "string" || specifier.trim() === "") {
    throw new Error(
      "[evjs:plugin-qiankun] qiankun entry loader requires a module path.",
    );
  }
  if (!isLocalModuleRequest(specifier)) return specifier;

  const rootContext = loaderContext.rootContext || process.cwd();
  const fromDir = path.dirname(loaderContext.resourcePath);
  const absolute = path.isAbsolute(specifier)
    ? specifier
    : path.resolve(rootContext, specifier);
  let relative = path.relative(fromDir, absolute).replaceAll("\\", "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function isLocalModuleRequest(specifier) {
  return specifier.startsWith(".") || path.isAbsolute(specifier);
}

function requiredString(value, label) {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(
    `[evjs:plugin-qiankun] qiankun entry loader requires ${label}.`,
  );
}
