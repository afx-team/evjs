import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// 1. Get or set version from root package.json
const rootPkgPath = path.resolve(rootDir, "package.json");
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));

const newVersion = process.argv[2];
if (newVersion) {
  rootPkg.version = newVersion;
  fs.writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
  console.log(`Set root version to ${newVersion}`);
}

const rootVersion = rootPkg.version;
console.log(`Syncing all packages to version: ${rootVersion}\n`);

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

  // Sync internal @evjs/* and evjs dependencies
  for (const depType of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]) {
    if (pkgJson[depType]) {
      for (const depName of Object.keys(pkgJson[depType])) {
        if (depName.startsWith("@evjs/") || depName === "evjs") {
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
    pkgJson.devDependencies?.evjs &&
    pkgJson.devDependencies.evjs !== expectedDep
  ) {
    pkgJson.devDependencies.evjs = expectedDep;
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
    console.log(`Updated packages/cli/templates/${template}/package.json`);
  }
}

console.log("\nDone syncing versions.");
