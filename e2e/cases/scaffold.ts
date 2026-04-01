import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("Scaffolding CLI E2E", () => {
  // Use a longer timeout for operational testing
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

    // 2. Rewrite local monorepo workspace dependencies to relative file: paths
    // so they can be installed successfully from npm within the os.tmpdir() space.
    const pkgPath = path.join(targetDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const packagesDir = path.resolve(import.meta.dirname, "../../packages");

    const injectFileDeps = (deps?: Record<string, string>) => {
      if (!deps) return;
      for (const [key] of Object.entries(deps)) {
        if (key.startsWith("@evjs/")) {
          const folderName = key.replace("@evjs/", "");
          deps[key] = `file:${path.join(packagesDir, folderName)}`;
        }
      }
    };
    injectFileDeps(pkg.dependencies);
    injectFileDeps(pkg.devDependencies);
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    // Force unique port to avoid EADDRINUSE
    fs.writeFileSync(
      path.join(targetDir, "ev.config.ts"),
      `export default { dev: { port: 39123 }, server: { dev: { port: 39124 } } };\n`,
    );

    // 3. Install dependencies inside the isolated tmpdir
    console.log("Installing monorepo dependencies in temp dir...");
    execSync("npm install --no-fund --no-audit", {
      cwd: targetDir,
      stdio: "inherit",
      env: cleanEnv,
    });

    // 4. Test production build
    console.log("Running ev build...");
    execSync("npm run build", {
      cwd: targetDir,
      stdio: "inherit",
      env: cleanEnv,
    });

    // Verify build outputs
    expect(
      fs.existsSync(path.join(targetDir, "dist", "client", "index.html")),
    ).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "dist", "server"))).toBe(true);

    // 5. Test dev server
    console.log("Running ev dev...");
    await new Promise<void>((resolve, reject) => {
      const devProcess = spawn("npx", ["ev", "dev"], {
        cwd: targetDir,
        stdio: "inherit",
        env: cleanEnv,
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

    // Validated end-to-end scaffolding!
    expect(true).toBe(true);
  });
});
