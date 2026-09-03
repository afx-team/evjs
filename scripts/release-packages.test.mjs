import assert from "node:assert/strict";
import test from "node:test";

import {
  getNpmTag,
  normalizeVersion,
  orderWorkspacePackages,
  planPublication,
} from "./release-packages.mjs";

test("normalizes valid release versions", () => {
  assert.equal(normalizeVersion("0.3.17"), "0.3.17");
  assert.equal(
    normalizeVersion("v1.2.3-alpha.1+build.5"),
    "1.2.3-alpha.1+build.5",
  );
});

test("rejects ambiguous or invalid release versions", () => {
  for (const version of ["", "1.2", "01.2.3", "1.2.3-01", "vv1.2.3"]) {
    assert.throws(() => normalizeVersion(version));
  }
});

test("maps release versions to npm dist-tags", () => {
  assert.equal(getNpmTag("1.2.3"), "latest");
  assert.equal(getNpmTag("1.2.3-alpha.1"), "alpha");
  assert.equal(getNpmTag("1.2.3-rc.2"), "rc");
  assert.equal(getNpmTag("1.2.3-beta.1"), "next");
});

test("orders packages after their internal dependencies", () => {
  const workspacePackages = [
    {
      packageJson: {
        name: "@evjs/cli",
        dependencies: { "@evjs/ev": "1.0.0" },
      },
    },
    {
      packageJson: {
        name: "@evjs/ev",
        dependencies: { "@evjs/shared": "1.0.0" },
      },
    },
    { packageJson: { name: "@evjs/shared" } },
  ];

  assert.deepEqual(
    orderWorkspacePackages(workspacePackages).map(
      ({ packageJson }) => packageJson.name,
    ),
    ["@evjs/shared", "@evjs/ev", "@evjs/cli"],
  );
});

test("rejects circular internal dependencies", () => {
  const workspacePackages = [
    {
      packageJson: {
        name: "@evjs/a",
        dependencies: { "@evjs/b": "1.0.0" },
      },
    },
    {
      packageJson: {
        name: "@evjs/b",
        dependencies: { "@evjs/a": "1.0.0" },
      },
    },
  ];

  assert.throws(
    () => orderWorkspacePackages(workspacePackages),
    /Circular workspace dependency/,
  );
});

test("continues a partial release only from matching tarballs and tags", () => {
  const packages = [
    {
      name: "@evjs/shared",
      version: "1.0.0",
      integrity: "sha512-shared",
    },
    {
      name: "@evjs/server",
      version: "1.0.0",
      integrity: "sha512-server",
    },
  ];
  const registryStates = new Map([
    [
      "@evjs/shared",
      {
        versionMetadata: { dist: { integrity: "sha512-shared" } },
        tagVersion: "1.0.0",
      },
    ],
    ["@evjs/server", { versionMetadata: null, tagVersion: "0.9.0" }],
  ]);

  const plan = planPublication(packages, registryStates, "latest");
  assert.equal(plan.complete, false);
  assert.deepEqual(
    plan.published.map(({ manifestPackage }) => manifestPackage.name),
    ["@evjs/shared"],
  );
  assert.deepEqual(
    plan.unpublished.map(({ name }) => name),
    ["@evjs/server"],
  );
});

test("rejects a partial release containing a different published tarball", () => {
  const packages = [
    {
      name: "@evjs/shared",
      version: "1.0.0",
      integrity: "sha512-local",
    },
    {
      name: "@evjs/server",
      version: "1.0.0",
      integrity: "sha512-server",
    },
  ];
  const registryStates = new Map([
    [
      "@evjs/shared",
      {
        versionMetadata: { dist: { integrity: "sha512-published" } },
        tagVersion: "1.0.0",
      },
    ],
    ["@evjs/server", { versionMetadata: null, tagVersion: null }],
  ]);

  assert.throws(
    () => planPublication(packages, registryStates, "latest"),
    /different tarball/,
  );
});

test("rejects a partial release with an unexpected dist-tag", () => {
  const packages = [
    {
      name: "@evjs/shared",
      version: "1.0.0",
      integrity: "sha512-shared",
    },
    {
      name: "@evjs/server",
      version: "1.0.0",
      integrity: "sha512-server",
    },
  ];
  const registryStates = new Map([
    [
      "@evjs/shared",
      {
        versionMetadata: { dist: { integrity: "sha512-shared" } },
        tagVersion: "1.1.0",
      },
    ],
    ["@evjs/server", { versionMetadata: null, tagVersion: null }],
  ]);

  assert.throws(
    () => planPublication(packages, registryStates, "latest"),
    /dist-tag points to 1.1.0/,
  );
});

test("treats a fully published release as idempotently complete", () => {
  const packages = [
    {
      name: "@evjs/shared",
      version: "1.0.0",
      integrity: "sha512-local",
    },
  ];
  const registryStates = new Map([
    [
      "@evjs/shared",
      {
        versionMetadata: { dist: { integrity: "sha512-older-build" } },
        tagVersion: "2.0.0",
      },
    ],
  ]);

  assert.equal(
    planPublication(packages, registryStates, "latest").complete,
    true,
  );
});
