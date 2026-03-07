import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// 1. Get current version from root package.json
const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(rootDir, "package.json"), "utf8"),
);
const rootVersion = rootPkg.version;

console.log(`Syncing all @evjs packages to root version: ${rootVersion}\n`);

// 2. Sync packages/* version and internal cross-dependencies
const packagesDir = path.resolve(rootDir, "packages");
const packages = fs.readdirSync(packagesDir);

for (const pkg of packages) {
  const pkgPath = path.join(packagesDir, pkg, "package.json");
  if (!fs.existsSync(pkgPath)) continue;

  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  let modified = false;

  // Sync own version
  if (pkgJson.version !== rootVersion) {
    pkgJson.version = rootVersion;
    modified = true;
  }

  // Sync internal @evjs/* dependencies
  for (const depType of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]) {
    if (pkgJson[depType]) {
      for (const depName of Object.keys(pkgJson[depType])) {
        if (depName.startsWith("@evjs/")) {
          // preserve prefix exactly but bump version, or just hardcode exact version
          const expected = rootVersion; // exact pinning for alpha, or use ^
          if (pkgJson[depType][depName] !== expected) {
            pkgJson[depType][depName] = expected;
            modified = true;
          }
        }
      }
    }
  }

  if (modified) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
    console.log(`Updated packages/${pkg}/package.json`);
  }
}

// 3. Sync cli templates dependency versions
console.log(`\nSyncing template dependencies...`);
const templatesDir = path.resolve(rootDir, "packages/cli/templates");
const templates = fs.readdirSync(templatesDir);

for (const template of templates) {
  const pkgPath = path.join(templatesDir, template, "package.json");
  if (!fs.existsSync(pkgPath)) continue;

  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  let modified = false;

  const expectedDep = `^${rootVersion}`;

  if (
    pkgJson.dependencies?.["@evjs/runtime"] &&
    pkgJson.dependencies["@evjs/runtime"] !== expectedDep
  ) {
    pkgJson.dependencies["@evjs/runtime"] = expectedDep;
    modified = true;
  }
  if (
    pkgJson.devDependencies?.["@evjs/webpack-plugin"] &&
    pkgJson.devDependencies["@evjs/webpack-plugin"] !== expectedDep
  ) {
    pkgJson.devDependencies["@evjs/webpack-plugin"] = expectedDep;
    modified = true;
  }
  if (
    pkgJson.devDependencies?.["evf"] &&
    pkgJson.devDependencies["evf"] !== expectedDep
  ) {
    pkgJson.devDependencies["evf"] = expectedDep;
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
    console.log(`Updated packages/cli/templates/${template}/package.json`);
  }
}

console.log("\nDone syncing versions.");
