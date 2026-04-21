import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("Scaffolding CLI E2E", () => {
  test.setTimeout(180_000);

  // Generate unique directory name without pre-creating it
  const targetDir = path.join(
    os.tmpdir(),
    `e2e-scaffold-${crypto.randomUUID().slice(0, 8)}`,
  );
  const cliPath = path.resolve(
    import.meta.dirname,
    "../../packages/create-app/dist/index.js",
  );

  test.afterAll(() => {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("create-app should scaffold, build, and run dev server", async ({
    page: _page,
  }, testInfo) => {
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith("npm_")) delete cleanEnv[key];
      if (key === "INIT_CWD") delete cleanEnv[key];
    }

    // 1. Scaffold the app (scaffold into the pre-created unique temp dir)
    const appName = path.basename(targetDir);
    console.log(`Scaffolding into ${targetDir}...`);
    execSync(`node ${cliPath} ${appName} -t basic-server-fns`, {
      cwd: path.dirname(targetDir),
      stdio: "inherit",
      env: cleanEnv,
    });

    expect(fs.existsSync(path.join(targetDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "src", "main.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "index.html"))).toBe(true);

    // 2. Pack monorepo packages into tarballs for clean isolation
    console.log("Packing monorepo packages to tarballs...");
    const packagesDir = path.resolve(import.meta.dirname, "../../packages");
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
    // (e.g. @evjs/cli depends on @evjs/bundler-webpack: "*")
    scaffoldPkg.overrides = {};
    for (const [name, ref] of Object.entries(packageTgzMap)) {
      scaffoldPkg.overrides[name] = ref;
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(scaffoldPkg, null, 2));

    // 3. Install dependencies (use a fresh npm cache to avoid stale 0.0.0 tarballs)
    console.log("Installing dependencies...");
    const npmCache = path.join(targetDir, ".npm-cache");
    execSync(`npm install --no-fund --no-audit --cache ${npmCache}`, {
      cwd: targetDir,
      stdio: "inherit",
      env: cleanEnv,
    });

    // Force unique port to avoid EADDRINUSE
    const devPort = 35123 + testInfo.workerIndex * 2;
    const serverDevPort = devPort + 1;
    fs.writeFileSync(
      path.join(targetDir, "ev.config.ts"),
      `export default { dev: { port: ${devPort} }, server: { dev: { port: ${serverDevPort} } } };\n`,
    );

    // 4. Test production build
    console.log("Running ev build...");
    execSync("npm run build", {
      cwd: targetDir,
      stdio: "inherit",
      env: cleanEnv,
    });

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
          stdio: "inherit",
        },
      );

      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      const timeout = setTimeout(() => {
        devProcess.kill("SIGTERM");
      }, 90_000);

      const checkServer = async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${devPort}/`);
          if (res.ok) {
            clearTimeout(timeout);
            devProcess.kill("SIGTERM");
            return;
          }
        } catch {
          // Connection refused — server not ready yet
        }
        if (!settled) setTimeout(checkServer, 2000);
      };
      checkServer();

      devProcess.on("close", (code: number | null) => {
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
