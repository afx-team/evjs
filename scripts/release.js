import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function main() {
  const rootPkgPath = path.resolve(rootDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  const currentVersion = pkg.version;

  // Usage: npm run release [new-version] [tag]
  // Node args start at [2]
  const newVersionInput = process.argv[2];
  const tagInput = process.argv[3];

  const newVersion = newVersionInput || currentVersion;
  const tag = tagInput || "latest";

  console.log(`Current version: ${currentVersion}`);
  console.log(`Target version:  ${newVersion}`);
  console.log(`Target tag:      ${tag}\n`);

  if (newVersion !== currentVersion) {
    console.log(`Bumping root version to ${newVersion}...`);
    pkg.version = newVersion;
    fs.writeFileSync(rootPkgPath, JSON.stringify(pkg, null, 2) + "\n");

    console.log("Synchronizing versions across workspaces...");
    execSync("node scripts/sync-versions.js", { stdio: "inherit", cwd: rootDir });

    console.log("Committing version bump...");
    execSync("git add -A", { stdio: "inherit", cwd: rootDir });
    execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: "inherit", cwd: rootDir });
  }

  console.log(`\nBuilding packages...`);
  execSync("npm run build", { stdio: "inherit", cwd: rootDir });

  console.log(`\nPublishing packages with tag "${tag}"...`);
  execSync(`npm publish --workspaces --if-present --access public --tag ${tag}`, { stdio: "inherit", cwd: rootDir });

  console.log(`\n✅ Successfully published version ${pkg.version} (@${tag})!`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
