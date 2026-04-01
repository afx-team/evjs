import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("Scaffolding CLI E2E", () => {
  test.setTimeout(180_000);

  const appName = "e2e-scaffold-test";
  const targetDir = path.join(os.tmpdir(), appName);
  const cliPath = path.resolve(
    import.meta.dirname,
    "../../packages/create-app/dist/index.js",
  );

  test.beforeAll(() => {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test.afterAll(() => {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("create-app should scaffold, build, and run dev server", async () => {
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith("npm_")) delete cleanEnv[key];
      if (key === "INIT_CWD") delete cleanEnv[key];
    }

    // 1. Scaffold the app
    console.log(`Scaffolding into ${targetDir}...`);
    execSync(`node ${cliPath} ${appName} -t basic-server-fns`, {
      cwd: os.tmpdir(),
      stdio: "inherit",
      env: cleanEnv,
    });

    expect(fs.existsSync(path.join(targetDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "src", "main.tsx"))).toBe(true);

    // 2. Pack monorepo packages into tarballs for clean isolation
    console.log("Packing monorepo packages to tarballs...");
    const packagesDir = path.resolve(import.meta.dirname, "../../packages");
    const packageTgzMap: Record<string, string> = {};
    for (const pkg of fs.readdirSync(packagesDir)) {
      const pkgPath = path.join(packagesDir, pkg);
      if (!fs.statSync(pkgPath).isDirectory()) continue;
      const tgzOutput = execSync(`npm pack --pack-destination ${targetDir}`, {
        cwd: pkgPath,
        encoding: "utf-8",
      }).trim();
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
    fs.writeFileSync(
      path.join(targetDir, "ev.config.ts"),
      `export default { dev: { port: 39123 }, server: { dev: { port: 39124 } } };\n`,
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

    return new Promise<void>((resolve, reject) => {
      const devProcess = spawn("npx", ["ev", "dev"], {
        cwd: targetDir,
        env: cleanEnv,
        stdio: "inherit",
      });

      const timeout = setTimeout(() => {
        devProcess.kill();
        reject(new Error("Dev server did not start within 30s"));
      }, 30_000);

      const checkServer = async () => {
        try {
          const res = await fetch("http://127.0.0.1:39123/");
          if (res.ok) {
            clearTimeout(timeout);
            devProcess.kill();
            resolve();
          } else {
            setTimeout(checkServer, 1000);
          }
        } catch {
          setTimeout(checkServer, 1000);
        }
      };
      checkServer();

      devProcess.on("close", (code: number | null) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`npx ev dev exited early with code ${code}`));
        }
      });
    });
  });
});
