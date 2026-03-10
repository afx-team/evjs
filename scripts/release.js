import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function main() {
  const rootPkgPath = path.resolve(rootDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  const currentVersion = pkg.version;

  const positionalArgs = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");

  const newVersion = positionalArgs[0] || currentVersion;
  const tag = positionalArgs[1] || "latest";

  if (dryRun) {
    console.log("[DRY RUN] No changes will be made.\n");
  }

  console.log(`Current version: ${currentVersion}`);
  console.log(`Target version:  ${newVersion}`);
  console.log(`Target tag:      ${tag}\n`);

  if (newVersion !== currentVersion) {
    console.log(`Bumping root version to ${newVersion}...`);
    if (!dryRun) {
      pkg.version = newVersion;
      fs.writeFileSync(rootPkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }

    console.log("Synchronizing versions across workspaces...");
    if (!dryRun) {
      execSync("node scripts/sync-versions.js", {
        stdio: "inherit",
        cwd: rootDir,
      });
    }

    console.log("Committing version bump...");
    if (!dryRun) {
      execSync("git add -A", { stdio: "inherit", cwd: rootDir });
      execSync(`git commit -m "chore: release v${newVersion}"`, {
        stdio: "inherit",
        cwd: rootDir,
      });
    }
  }

  console.log(`\nBuilding packages...`);
  if (!dryRun) {
    execSync("npm run build", { stdio: "inherit", cwd: rootDir });
  }

  console.log(`\nPublishing packages with tag "${tag}"...`);
  if (!dryRun) {
    execSync(
      `npm publish --workspaces --if-present --access public --tag ${tag}`,
      { stdio: "inherit", cwd: rootDir },
    );
  }

  const suffix = dryRun ? " (dry run — nothing was published)" : "";
  console.log(
    `\n✅ Successfully published version ${newVersion} (@${tag})!${suffix}`,
  );
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
