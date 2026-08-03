import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const SCAFFOLD_TEST_TIMEOUT = 12 * 60_000;
const SCAFFOLD_INSTALL_TIMEOUT = 8 * 60_000;
const DEV_PROCESS_STOP_TIMEOUT = 5_000;

function waitForChildExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      clearTimeout(timeout);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref();
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
}

async function stopChildProcess(
  child: ReturnType<typeof spawn> | undefined,
): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const exitedAfterTerminate = waitForChildExit(
    child,
    DEV_PROCESS_STOP_TIMEOUT,
  );
  child.kill("SIGTERM");
  if (await exitedAfterTerminate) return;

  const exitedAfterKill = waitForChildExit(child, DEV_PROCESS_STOP_TIMEOUT);
  child.kill("SIGKILL");
  if (!(await exitedAfterKill)) {
    throw new Error("Dev process did not exit after SIGKILL");
  }
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

test.describe("Scaffolding CLI E2E", () => {
  test.setTimeout(SCAFFOLD_TEST_TIMEOUT);

  // Generate unique directory name without pre-creating it
  const targetDir = path.join(
    os.tmpdir(),
    `e2e-scaffold-${crypto.randomUUID().slice(0, 8)}`,
  );
  const cliPath = path.resolve(
    import.meta.dirname,
    "../../packages/create-app/bin/create-evjs-app.js",
  );
  let activeDevProcess: ReturnType<typeof spawn> | undefined;

  test.afterAll(async () => {
    await stopChildProcess(activeDevProcess);
    activeDevProcess = undefined;
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("create-app should scaffold, build, and run dev server", async ({
    page: _page,
  }) => {
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith("npm_")) delete cleanEnv[key];
      if (key === "INIT_CWD") delete cleanEnv[key];
    }
    delete cleanEnv.NODE_ENV;

    // 1. Scaffold the app (scaffold into the pre-created unique temp dir)
    const appName = path.basename(targetDir);
    console.log(`Scaffolding into ${targetDir}...`);
    execSync(`node ${cliPath} ${appName} -t basic`, {
      cwd: path.dirname(targetDir),
      stdio: "inherit",
      env: cleanEnv,
    });

    expect(fs.existsSync(path.join(targetDir, "package.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(targetDir, "src", "pages", "page.tsx")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(targetDir, "src", "pages", "page.config.ts")),
    ).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "index.html"))).toBe(true);

    // 2. Pack monorepo packages into tarballs for clean isolation
    console.log("Packing monorepo packages to tarballs...");
    const packagesDir = path.resolve(import.meta.dirname, "../../packages");
    const workspaceUtooPackRequire = createRequire(
      path.join(packagesDir, "bundler-utoopack", "package.json"),
    );
    const workspaceUtooPackPackage = workspaceUtooPackRequire(
      "@utoo/pack/package.json",
    ) as { version: string };
    const packageTgzMap: Record<string, string> = {};
    for (const pkg of fs.readdirSync(packagesDir)) {
      const pkgPath = path.join(packagesDir, pkg);
      if (!fs.statSync(pkgPath).isDirectory()) continue;

      const tgzOutput = execSync(
        `npm pack --pack-destination ${targetDir} --ignore-scripts`,
        {
          cwd: pkgPath,
          encoding: "utf-8",
        },
      ).trim();
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(pkgPath, "package.json"), "utf8"),
      );
      packageTgzMap[pkgJson.name] = `file:./${tgzOutput}`;
    }

    // Rewrite @evjs/* deps to point at local tarballs
    const pkgJsonPath = path.join(targetDir, "package.json");
    const scaffoldPkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    for (const deps of [
      scaffoldPkg.dependencies,
      scaffoldPkg.devDependencies,
    ]) {
      if (!deps) continue;
      for (const key of Object.keys(deps)) {
        if (packageTgzMap[key]) {
          deps[key] = packageTgzMap[key];
        } else if (key.startsWith("@evjs/")) {
          throw new Error(
            `Workspace package ${key} not found during npm pack!`,
          );
        }
      }
    }
    // Force transitive @evjs/* deps to use local tarballs too
    scaffoldPkg.overrides = {};
    for (const [name, ref] of Object.entries(packageTgzMap)) {
      scaffoldPkg.overrides[name] = ref;
    }
    // Keep the isolated fixture on the native dependency graph validated by
    // the workspace install instead of re-resolving a newer compatible pack.
    scaffoldPkg.overrides["@utoo/pack"] = workspaceUtooPackPackage.version;
    fs.writeFileSync(pkgJsonPath, JSON.stringify(scaffoldPkg, null, 2));

    // 3. Reuse the runner cache for registry dependencies. Workspace tarballs
    // live under this unique fixture directory, so their file paths cannot
    // collide with a previous 0.0.0 package.
    console.log("Installing dependencies...");
    execSync(
      "npm install --include=dev --include=optional --no-fund --no-audit",
      {
        cwd: targetDir,
        stdio: "inherit",
        env: cleanEnv,
        timeout: SCAFFOLD_INSTALL_TIMEOUT,
      },
    );

    const installedEvBuildEntry = path.join(
      targetDir,
      "node_modules",
      "@evjs",
      "ev",
      "esm",
      "_internal",
      "build",
      "index.js",
    );
    expect(fs.existsSync(installedEvBuildEntry)).toBe(true);
    const fixtureBundlerRequire = createRequire(
      path.join(
        targetDir,
        "node_modules",
        "@evjs",
        "bundler-utoopack",
        "package.json",
      ),
    );
    expect(() => fixtureBundlerRequire("@utoo/pack")).not.toThrow();

    // Allocate real free ports; deterministic offsets can collide with local
    // processes or with stale servers from a previous failed run.
    const devPort = await getAvailablePort();
    const serverDevPort = await getAvailablePort();
    fs.writeFileSync(
      path.join(targetDir, "ev.config.ts"),
      `export default { routing: { mode: "spa" }, dev: { port: ${devPort} }, server: { dev: { port: ${serverDevPort} } } };\n`,
    );

    // 4. Test production build
    console.log("Running ev build...");
    execSync("npm run build", {
      cwd: targetDir,
      stdio: "inherit",
      env: cleanEnv,
    });
    expect(fs.existsSync(installedEvBuildEntry)).toBe(true);

    expect(
      fs.existsSync(path.join(targetDir, "dist", "client", "index.html")),
    ).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "dist", "server"))).toBe(true);

    // 5. Test dev server
    console.log("Starting dev server...");

    await new Promise<void>((resolve, reject) => {
      // Avoid 'npx' here because kill() on npx doesn't always forward to the child Node process,
      // leaving 'ev dev' orphaned to race with our afterAll deletion hook.
      const devProcess = spawn(
        "node",
        ["./node_modules/@evjs/cli/bin/ev.js", "dev"],
        {
          cwd: targetDir,
          env: cleanEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      activeDevProcess = devProcess;

      let settled = false;
      let closed = false;
      let webReady = false;
      let apiReady = false;
      let stdout = "";
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      const maybeResolveReady = () => {
        if (!webReady || !apiReady) return;
        clearTimeout(timeout);
        devProcess.kill("SIGTERM");
        forceKill();
        settle(() => resolve());
      };

      const timeout = setTimeout(() => {
        devProcess.kill("SIGTERM");
        forceKill();
        settle(() => reject(new Error("Dev server did not become ready")));
      }, 90_000);
      const forceKill = () => {
        setTimeout(() => {
          if (!closed) {
            devProcess.kill("SIGKILL");
          }
        }, 5_000).unref();
      };

      devProcess.stdout?.on("data", (data) => {
        const text = data.toString();
        process.stdout.write(data);
        stdout += text;
        if (stdout.includes("App listening at:")) {
          webReady = true;
        }
        if (stdout.includes("API server listening at:")) {
          apiReady = true;
        }
        maybeResolveReady();
      });
      devProcess.stderr?.on("data", (data) => {
        process.stderr.write(data);
      });

      devProcess.on("close", (code: number | null) => {
        closed = true;
        if (activeDevProcess === devProcess) activeDevProcess = undefined;
        clearTimeout(timeout);
        if (code !== 0 && code !== null && !settled) {
          settle(() =>
            reject(new Error(`node ev dev exited with code ${code}`)),
          );
        } else {
          settle(() => resolve());
        }
      });
    });
  });
});
