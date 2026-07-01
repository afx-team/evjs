import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "@playwright/test";
import { buildExample, expect } from "../fixtures";

const masterExampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "qiankun-master",
);
const slaveExampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "qiankun-slave",
);

let masterServer: http.Server | undefined;
let slaveServer: http.Server | undefined;
let masterURL = "";
let slaveURL = "";

test.describe("qiankun", () => {
  test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
    const bundlerName =
      (testInfo.project.use as unknown as { bundlerName?: string })
        .bundlerName ?? "utoopack";

    await buildExample(slaveExampleDir, bundlerName);
    await buildExample(masterExampleDir, bundlerName);

    const slaveDistDir = path.join(slaveExampleDir, "dist", "client");
    const masterDistDir = path.join(masterExampleDir, "dist", "client");

    slaveServer = createStaticServer(slaveDistDir);
    slaveURL = await listen(slaveServer);

    masterServer = createStaticServer(masterDistDir, {
      mounts: [
        {
          prefix: "/__qiankun_slave",
          dir: slaveDistDir,
        },
      ],
    });
    masterURL = await listen(masterServer);
  });

  test.afterAll(async () => {
    await Promise.all([closeServer(masterServer), closeServer(slaveServer)]);
  });

  test("renders the slave as a standalone file-convention SPA", async ({
    page,
  }) => {
    await page.goto(slaveURL);

    await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Orders")).toBeVisible();
    await expect(page.getByText("Inventory")).toBeVisible();
    await expect(page.getByText("Revenue")).toBeVisible();
  });

  test("loads the slave after navigating from the master home page", async ({
    page,
  }) => {
    await page.goto(masterURL);

    await expect(
      page.getByRole("heading", { name: "Qiankun master shell" }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Open catalog" }).click();
    await expect(page).toHaveURL(`${masterURL}/catalog`);
    await expect(
      page.getByRole("heading", { name: "Catalog workspace" }),
    ).toBeVisible();
    await expect(page.getByText("qiankun slave", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Orders")).toBeVisible();
    await expect(page.getByText("Inventory")).toBeVisible();
    await expect(page.getByText("Revenue")).toBeVisible();
  });
});

function createStaticServer(
  rootDir: string,
  options?: {
    mounts?: Array<{
      prefix: string;
      dir: string;
    }>;
  },
): http.Server {
  const indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf-8");

  return http.createServer((req, res) => {
    const pathname = getRequestPathname(req.url || "/");
    const mountedFile = resolveMountedFilePath(pathname, options?.mounts ?? []);
    if (mountedFile && serveFile(mountedFile, res)) return;

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexHtml);
      return;
    }

    const filePath = resolveStaticFilePath(rootDir, pathname);
    if (filePath && serveFile(filePath, res)) return;

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(indexHtml);
  });
}

function resolveMountedFilePath(
  pathname: string,
  mounts: Array<{ prefix: string; dir: string }>,
): string | undefined {
  for (const mount of mounts) {
    if (!pathMatchesPrefix(pathname, mount.prefix)) continue;
    const relativePathname = pathname.slice(mount.prefix.length) || "/";
    return resolveStaticFilePath(mount.dir, relativePathname);
  }
  return undefined;
}

function resolveStaticFilePath(
  rootDir: string,
  pathname: string,
): string | undefined {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, decodedPathname.replace(/^\/+/, ""));
  return filePath === root || filePath.startsWith(`${root}${path.sep}`)
    ? filePath
    : undefined;
}

function serveFile(filePath: string, res: http.ServerResponse): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  res.writeHead(200, {
    "Content-Type": getContentType(path.extname(filePath)),
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function getRequestPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] || "/";
  }
}

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  const normalizedPrefix = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return (
    pathname === normalizedPrefix ||
    pathname.startsWith(`${normalizedPrefix.replace(/\/+$/, "")}/`)
  );
}

function getContentType(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".json":
    case ".map":
      return "application/json";
    default:
      return "text/plain";
  }
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected HTTP server to listen on a TCP port.");
  }
  return `http://localhost:${address.port}`;
}

async function closeServer(server: http.Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
