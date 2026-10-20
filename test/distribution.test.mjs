import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { createDocument, createFakeHost, loadBundle } from "./harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK = path.join(ROOT, ".work", "distribution-tests");
const ROOT_PACKAGE = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const PACKAGE_NAME = ROOT_PACKAGE.name;

function runNpm(args, cwd) {
  // npm sets this when invoked through `npm run`; using node + npm-cli avoids Windows .cmd ENOENT.
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli && path.isAbsolute(npmCli), "run this test with `npm run test:distribution` so npm_execpath is available");
  const env = {
    ...process.env,
    npm_config_cache: path.join(ROOT, ".work", "npm-cache"),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  // Nested npm must resolve the fixture's prefix, not reuse the parent `npm run` checkout.
  delete env.npm_config_local_prefix;
  delete env.INIT_CWD;
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `npm ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function runGit(args, cwd, isolatedConfig) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: isolatedConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "DSH Distribution Test",
      GIT_AUTHOR_EMAIL: "dsh-distribution@example.invalid",
      GIT_COMMITTER_NAME: "DSH Distribution Test",
      GIT_COMMITTER_EMAIL: "dsh-distribution@example.invalid",
    },
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function assertPackageIdentity(pkg, clientSource, patch, { checkNoRuntimeDependencies = true } = {}) {
  assert.equal(pkg.name, PACKAGE_NAME);
  assert.equal(pkg.version, ROOT_PACKAGE.version);
  assert.equal(pkg.publishConfig?.access, "public");
  assert.equal(pkg.publishConfig?.registry, "https://registry.npmjs.org/");
  if (checkNoRuntimeDependencies) {
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      assert.deepEqual(pkg[field] ?? {}, {}, `${field} must not add install-time/runtime packages`);
    }
  }
  const installLifecycle = ["preinstall", "install", "postinstall", "prepare", "prepublish"];
  for (const name of installLifecycle) {
    assert.equal(pkg.scripts?.[name], undefined, `package must not define ${name}`);
  }

  const clientId = /window\.__ModuleLoader__\.load\(\s*\{\s*id:\s*["']([^"']+)["']/.exec(clientSource)?.[1];
  const entryId = /var ENTRY_ID\s*=\s*["']([^"']+)["']/.exec(clientSource)?.[1];
  const hostId = /const PACKAGE_ID\s*=\s*["']([^"']+)["']/.exec(readFileSync(path.join(ROOT, "lib", "index.js"), "utf8"))?.[1];
  assert.equal(clientId, pkg.name, "client module registration id must match npm name");
  assert.equal(entryId, pkg.name, "client Cordis slot id must match npm name");
  assert.equal(hostId, pkg.name, "host runtime id must match npm name");
  assert.match(patch, new RegExp(`name:\\s*${pkg.name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*(?:\\r?\\n|$)`), "patch Cordis name must match npm name");
}

function assertPackageFileWhitelist(files) {
  const names = files.map((file) => file.path.replaceAll("\\", "/"));
  const allowed = new Set([
    "package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "INSTALL.md", "VALIDATION.md", "PUBLISHING.md", "CHANGELOG.md",
    "install-profile.ps1", "pack-dist.ps1", "install.cmd", "screenshots.json", "cordis.patch.yml",
    "lib/index.js", "lib/client.js",
    ...((JSON.parse(readFileSync(path.join(ROOT, "screenshots.json"), "utf8")) ?? [])),
  ]);
  assert.ok(names.includes("package.json"), "tarball must contain package metadata");
  assert.ok(names.includes("lib/index.js"), "tarball must contain host entry");
  assert.ok(names.includes("lib/client.js"), "tarball must contain client bundle");
  assert.ok(names.includes("cordis.patch.yml"), "tarball must contain DSH patch");
  const unexpected = names.filter((name) => !allowed.has(name));
  assert.deepEqual(unexpected, [], `tarball has files outside the release allowlist: ${unexpected.join(", ")}`);
  for (const name of names) {
    assert.doesNotMatch(name, /(^|\/)(?:\.git|\.work|node_modules|test|tests)(?:\/|$)/i, `forbidden package path: ${name}`);
    assert.doesNotMatch(name, /(?:^|\/)(?:\.npmrc|\.env(?:\.|$)|credentials?)(?:\/|$)/i, `credential-like file: ${name}`);
  }
}

async function exerciseInstall(project, sourceLabel) {
  const entryPath = path.join(project, "node_modules", PACKAGE_NAME, "lib", "index.js");
  const clientPath = path.join(project, "node_modules", PACKAGE_NAME, "lib", "client.js");
  const installedPkgPath = path.join(project, "node_modules", PACKAGE_NAME, "package.json");
  const installed = JSON.parse(readFileSync(installedPkgPath, "utf8"));
  const clientSource = readFileSync(clientPath, "utf8");
  const patch = readFileSync(path.join(project, "node_modules", PACKAGE_NAME, "cordis.patch.yml"), "utf8");
  assertPackageIdentity(installed, clientSource, patch, { checkNoRuntimeDependencies: false });

  const hostModule = await import(`${pathToFileURL(entryPath).href}?distribution=${encodeURIComponent(sourceLabel)}`);
  const logged = [];
  const logger = () => ({ info: (message) => logged.push(String(message)) });
  assert.doesNotThrow(() => hostModule.default.apply({ logger }), `${sourceLabel}: default host apply must not throw`);
  assert.ok(logged.some((message) => message.includes("lib/client.js") && message.includes("就绪")), `${sourceLabel}: host entry should audit the installed client bundle`);

  const document = createDocument();
  const bundle = loadBundle(clientPath, document);
  assert.equal(bundle.registration.id, PACKAGE_NAME, `${sourceLabel}: shipped client bundle registration id`);
  const host = createFakeHost();
  assert.doesNotThrow(() => bundle.plugin.apply(host.ctx), `${sourceLabel}: client apply must not throw`);
  assert.equal(host.registered.length, 1, `${sourceLabel}: client registers its Cordis slot`);
  assert.equal(host.registered[0].opts.id, PACKAGE_NAME, `${sourceLabel}: registered slot id must match package id`);
}

test("release tarball and native npm/local installs work from the published artifact shape", async (t) => {
  mkdirSync(WORK, { recursive: true });
  const tempRoot = mkdtempSync(path.join(WORK, "case-"));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const packed = path.join(tempRoot, "packed");
  const fromTarball = path.join(tempRoot, "install-tarball");
  const fromDirectory = path.join(tempRoot, "install-directory");
  const extracted = path.join(tempRoot, "extract-tarball");
  const gitRepo = path.join(tempRoot, "git-source");
  const fromGit = path.join(tempRoot, "install-git");
  const isolatedGitConfig = path.join(tempRoot, "empty.gitconfig");
  for (const dir of [packed, fromTarball, fromDirectory, extracted, gitRepo, fromGit]) {
    // npm requires the destination and each project directory to exist.
    mkdirSync(dir, { recursive: true });
  }
  for (const project of [fromTarball, fromDirectory, extracted, fromGit]) {
    writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "dsh-distribution-fixture", version: "1.0.0", private: true }));
  }
  writeFileSync(isolatedGitConfig, "");

  const packOutput = runNpm(["pack", "--json", "--ignore-scripts", "--pack-destination", packed], ROOT);
  const packResults = JSON.parse(packOutput);
  assert.equal(packResults.length, 1, "npm pack should produce exactly one archive");
  assert.equal(packResults[0].name, PACKAGE_NAME);
  assert.equal(packResults[0].version, ROOT_PACKAGE.version);
  assertPackageFileWhitelist(packResults[0].files);
  const archiveName = packResults[0].filename;
  const archivePath = path.join(packed, archiveName);
  assert.ok(readdirSync(packed).includes(archiveName), "npm pack JSON archive must exist");
  const packageJsonText = readFileSync(path.join(ROOT, "package.json"), "utf8");
  const clientSource = readFileSync(path.join(ROOT, "lib", "client.js"), "utf8");
  assertPackageIdentity(JSON.parse(packageJsonText), clientSource, readFileSync(path.join(ROOT, "cordis.patch.yml"), "utf8"));

  runNpm(["install", "--omit=dev", "--ignore-scripts", "--package-lock=false", archivePath], fromTarball);
  await exerciseInstall(fromTarball, "tarball");

  runNpm(["install", "--omit=dev", "--ignore-scripts", "--install-links", "--package-lock=false", ROOT], fromDirectory);
  await exerciseInstall(fromDirectory, "local directory");

  // Ask npm to unpack the real archive, then commit those extracted release files as a fixture source.
  runNpm(["install", "--omit=dev", "--ignore-scripts", "--package-lock=false", archivePath], extracted);
  cpSync(path.join(extracted, "node_modules", PACKAGE_NAME), gitRepo, { recursive: true });
  runGit(["init", "--quiet"], gitRepo, isolatedGitConfig);
  runGit(["add", "-A"], gitRepo, isolatedGitConfig);
  runGit(["-c", "user.name=DSH Distribution Test", "-c", "user.email=dsh-distribution@example.invalid", "commit", "--quiet", "-m", "fixture release"], gitRepo, isolatedGitConfig);
  const tag = "dsh-codex-ui-distribution-test";
  runGit(["tag", tag], gitRepo, isolatedGitConfig);
  const gitUrl = `git+${pathToFileURL(gitRepo).href}#${tag}`;
  runNpm(["install", "--omit=dev", "--package-lock=false", gitUrl], fromGit);
  await exerciseInstall(fromGit, "git+file tag");
});
