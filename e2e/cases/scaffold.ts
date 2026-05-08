import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

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
  }) => {
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith("npm_")) delete cleanEnv[key];
      if (key === "INIT_CWD") delete cleanEnv[key];
    }

    // 1. Scaffold the app (scaffold into the pre-created unique temp dir)
    const appName = path.basename(targetDir);
    console.log(`Scaffolding into ${targetDir}...`);
    execSync(`node ${cliPath} ${appName} -t basic`, {
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

    // Allocate real free ports; deterministic offsets can collide with local
    // processes or with stale servers from a previous failed run.
    const devPort = await getAvailablePort();
    const serverDevPort = await getAvailablePort();
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
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let settled = false;
      let closed = false;
      let webReady = false;
      let apiReady = false;
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
        if (text.includes(`http://localhost:${devPort}`)) {
          webReady = true;
        }
        if (text.includes("API server ready")) {
          apiReady = true;
        }
        maybeResolveReady();
      });
      devProcess.stderr?.on("data", (data) => {
        process.stderr.write(data);
      });

      devProcess.on("close", (code: number | null) => {
        closed = true;
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
