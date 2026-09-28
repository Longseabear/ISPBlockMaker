import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureProjectLayout, normalizeWorkspaceFolder, planProjectLayout, sourceRoot } from "../server/project-layout.mjs";
import { openWorkspace } from "../server/workspaces.mjs";
import { initialProject } from "../server/model.mjs";
import { graphSpec } from "../server/store.mjs";
import { fileURLToPath } from "node:url";

const git = (cwd, ...args) => execFileSync("git", args, {
  cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
});
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "isp-layout-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("isp-layout-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function put(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function repo(root) {
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Layout test");
  git(root, "config", "user.email", "layout@example.invalid");
  put(root, "graph.json", '{"name":"test","blocks":[],"edges":[]}\n');
  put(root, "blocks/process.py", "def process(): return 1\n");
  put(root, ".gitignore", ".isp/\ndata/\ntmp/\nartifacts/\n*.cache\n");
  put(root, "AGENTS.md", "User project instructions.\n");
  put(root, ".agents/skills/custom/SKILL.md", "User skill.\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "baseline");
}

test("new workspace initializes an isolated source repository without inventing a commit", t => {
  const root = fixture(t);
  assert.equal(sourceRoot(root), root);
  const plan = planProjectLayout(root);
  assert.equal(plan.kind, "initialize");
  assert.equal(fs.existsSync(path.join(root, ".isp")), false);
  const source = ensureProjectLayout(root);
  assert.equal(source, path.join(root, "project"));
  assert.equal(sourceRoot(root), source);
  assert.equal(fs.existsSync(path.join(root, ".git")), false);
  assert.equal(fs.statSync(path.join(source, ".git")).isDirectory(), true);
  assert.equal(git(source, "symbolic-ref", "--short", "HEAD").trim(), "main");
  assert.throws(() => git(source, "rev-parse", "--verify", "HEAD"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".isp/workspace.json"))), { version: 1, sourceRoot: "project" });
  assert.equal(ensureProjectLayout(root), source);
  assert.equal(normalizeWorkspaceFolder(source), root);
  assert.equal(ensureProjectLayout(source), source);
  assert.equal(sourceRoot(source), source);
  assert.equal(fs.existsSync(path.join(source, "project")), false);
});

test("a bundle restored without history gets an empty Git repository even when its layout marker exists", t => {
  const root = fixture(t);
  put(root, "project/graph.json", "{}");
  put(root, ".isp/workspace.json", JSON.stringify({ version: 1, sourceRoot: "project" }));
  const source = ensureProjectLayout(root);
  assert.equal(fs.statSync(path.join(source, ".git")).isDirectory(), true);
  assert.throws(() => git(source, "rev-parse", "--verify", "HEAD"));
});

test("migration preserves history, branches, tags, staging, edits, ignored files and local data", t => {
  const root = fixture(t);
  repo(root);
  git(root, "branch", "candidate");
  git(root, "tag", "-a", "accepted", "-m", "Original result");
  git(root, "update-ref", "refs/isp/checkpoints/baseline", "HEAD");
  put(root, "blocks/process.py", "def process(): return 2\n");
  git(root, "add", "blocks/process.py");
  put(root, "blocks/process.py", "def process(): return 3\n");
  put(root, ".agents/skills/custom/SKILL.md", "User skill with uncommitted edits.\n");
  put(root, ".agents/skills/new/SKILL.md", "Untracked custom skill.\n");
  put(root, "blocks/experiment.py", "# untracked implementation\n");
  put(root, "scratch.cache", "Ignored intermediate source data");
  put(root, ".isp/project.json", '{"jobs":[{"id":"keep"}]}');
  put(root, "data/input.raw", Buffer.from([0, 255, 12, 0]));
  put(root, "tmp/scratch.txt", "local tmp");
  put(root, "artifacts/report.html", "local report");
  put(root, ".venv/Scripts/pip.exe", "launcher referencing original venv path");
  put(root, ".git/info/exclude", ".venv/\n");
  const before = {
    refs: git(root, "show-ref"), status: git(root, "status", "--porcelain", "-z", "--untracked-files=all"),
    staged: git(root, "diff", "--cached", "--binary"), edits: git(root, "diff", "--binary"),
    index: fs.readFileSync(path.join(root, ".git/index")),
    state: fs.readFileSync(path.join(root, ".isp/project.json")),
  };
  const plan = planProjectLayout(root);
  assert.equal(plan.kind, "migrate");
  assert.equal(plan.actions.find(a => a.name === ".agents").kind, "copy");
  assert.equal(plan.actions.some(a => a.name === "data"), false);
  assert.equal(fs.existsSync(path.join(root, "project")), false);
  const source = ensureProjectLayout(root);
  assert.deepEqual(fs.readFileSync(path.join(source, ".git/index")), before.index);
  assert.equal(git(source, "show-ref"), before.refs);
  assert.equal(git(source, "status", "--porcelain", "-z", "--untracked-files=all"), before.status);
  assert.equal(git(source, "diff", "--cached", "--binary"), before.staged);
  assert.equal(git(source, "diff", "--binary"), before.edits);
  assert.deepEqual(fs.readFileSync(path.join(root, ".isp/project.json")), before.state);
  assert.equal(fs.readFileSync(path.join(root, "artifacts/report.html"), "utf8"), "local report");
  assert.equal(fs.readFileSync(path.join(root, ".venv/Scripts/pip.exe"), "utf8"), "launcher referencing original venv path");
  assert.deepEqual(fs.readFileSync(path.join(root, "data/input.raw")), Buffer.from([0, 255, 12, 0]));
  assert.equal(fs.readFileSync(path.join(source, "scratch.cache"), "utf8"), "Ignored intermediate source data");
  assert.equal(fs.readFileSync(path.join(root, ".agents/skills/custom/SKILL.md"), "utf8"), "User skill with uncommitted edits.\n");
  assert.equal(fs.existsSync(path.join(root, "graph.json")), false);
  assert.equal(ensureProjectLayout(root), source);
});

test("collisions and tracked local data are rejected before any source moves", t => {
  const root = fixture(t);
  repo(root);
  put(root, "project/existing.txt", "Never overwrite");
  assert.throws(() => ensureProjectLayout(root), /already exists/);
  assert.equal(fs.existsSync(path.join(root, ".isp")), false);
  assert.equal(fs.readFileSync(path.join(root, "project/existing.txt"), "utf8"), "Never overwrite");
  fs.renameSync(path.join(root, "project"), path.join(root, "existing-project"));
  put(root, "data/important.raw", "Tracked input");
  git(root, "add", "-f", "data/important.raw");
  assert.throws(() => ensureProjectLayout(root), /Local data is tracked/);
  assert.equal(fs.existsSync(path.join(root, ".isp")), false);
  assert.equal(fs.existsSync(path.join(root, ".git")), true);
  assert.equal(fs.existsSync(path.join(root, "graph.json")), true);
});

test("linked worktrees and submodules are refused without losing their repository", t => {
  const parent = fixture(t), original = path.join(parent, "original"), linked = path.join(parent, "linked");
  fs.mkdirSync(original);
  repo(original);
  git(original, "worktree", "add", "-b", "linked", linked);
  assert.throws(() => ensureProjectLayout(linked), /worktrees\/submodules/);
  assert.throws(() => ensureProjectLayout(original), /manual migration/);
  assert.equal(fs.existsSync(path.join(linked, "graph.json")), true);
  git(original, "worktree", "remove", linked);
  const hash = git(original, "rev-parse", "HEAD").trim();
  git(original, "update-index", "--add", "--cacheinfo", `160000,${hash},nested`);
  assert.throws(() => ensureProjectLayout(original), /submodules/);
  assert.equal(fs.existsSync(path.join(original, "project")), false);
});

test("an interrupted relocation resumes without recopying or losing staged data", t => {
  const root = fixture(t);
  repo(root);
  const before = git(root, "show-ref");
  const plan = planProjectLayout(root);
  fs.mkdirSync(path.join(root, "project"));
  put(root, ".isp/layout-migration.json", JSON.stringify({ version: 1, workspace: root, sourceRoot: "project", actions: plan.actions }));
  fs.renameSync(path.join(root, "graph.json"), path.join(root, "project/graph.json"));
  fs.mkdirSync(path.join(root, "project/.agents"));
  assert.throws(() => sourceRoot(root), /incomplete/);
  assert.equal(planProjectLayout(root).kind, "resume");
  const source = ensureProjectLayout(root);
  assert.equal(git(source, "show-ref"), before);
  assert.equal(git(source, "status", "--porcelain"), "");
  assert.equal(fs.existsSync(path.join(root, ".isp/layout-migration.json")), false);
  assert.equal(fs.existsSync(path.join(root, ".isp/layout-migrated.json")), true);
});

test("layout metadata cannot escape the workspace and a restored project can be adopted", t => {
  const root = fixture(t);
  put(root, ".isp/workspace.json", JSON.stringify({ version: 1, sourceRoot: "../outside" }));
  assert.throws(() => sourceRoot(root), /Unsupported workspace layout/);
  fs.unlinkSync(path.join(root, ".isp/workspace.json"));
  put(root, ".isp/layout-migration.json", JSON.stringify({ version: 1, workspace: root, sourceRoot: "project", actions: [{ name: "../outside", kind: "move" }] }));
  assert.throws(() => ensureProjectLayout(root), /Unsafe workspace migration journal/);
  assert.equal(fs.existsSync(path.join(root, "project")), false);
  fs.unlinkSync(path.join(root, ".isp/layout-migration.json"));
  put(root, "project/graph.json", "{}");
  assert.equal(sourceRoot(root), path.join(root, "project"));
  assert.equal(planProjectLayout(root).kind, "adopt");
  assert.equal(ensureProjectLayout(root), path.join(root, "project"));
});

test("resume refuses a conflicting guidance copy instead of accepting partial or changed bytes", t => {
  const root = fixture(t);
  repo(root);
  const plan = planProjectLayout(root);
  put(root, ".isp/layout-migration.json", JSON.stringify({ version: 1, workspace: root, sourceRoot: "project", actions: plan.actions }));
  put(root, "project/AGENTS.md", "Partial");
  assert.throws(() => ensureProjectLayout(root), /both copies were preserved/);
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "User project instructions.\n");
  assert.equal(fs.readFileSync(path.join(root, "project/AGENTS.md"), "utf8"), "Partial");
  assert.equal(fs.existsSync(path.join(root, ".git")), true);
  assert.equal(fs.existsSync(path.join(root, ".isp/workspace.json")), false);
});

test("Windows reserved folder names stay local regardless of casing", { skip: process.platform !== "win32" }, t => {
  const root = fixture(t);
  put(root, ".ISP/project.json", '{"keep":"local"}');
  put(root, "Data/input.raw", "pixels");
  const plan = planProjectLayout(root);
  assert.equal(plan.actions.length, 0);
  ensureProjectLayout(root);
  assert.equal(fs.readFileSync(path.join(root, ".ISP/project.json"), "utf8"), '{"keep":"local"}');
  assert.equal(fs.readFileSync(path.join(root, "Data/input.raw"), "utf8"), "pixels");
});

test("workspace setup routes copied guidance and generated CLI to the authoritative workspace tools", t => {
  const workspace = fixture(t);
  repo(workspace);
  put(workspace, "graph.json", JSON.stringify(graphSpec(initialProject)));
  put(workspace, "isp.mjs", 'await import("./.isp/tools/isp.mjs");\n');
  git(workspace, "add", "graph.json", "isp.mjs");
  git(workspace, "commit", "-m", "Legacy workspace bridge");
  const framework = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const opened = openWorkspace(workspace, framework);
  assert.equal(opened.sourceRoot, path.join(workspace, "project"));
  assert.equal(opened.store.get().name, initialProject.name);
  assert.match(fs.readFileSync(path.join(opened.sourceRoot, "AGENTS.md"), "utf8"), /User project instructions/);
  assert.match(fs.readFileSync(path.join(opened.sourceRoot, "AGENTS.md"), "utf8"), /\.\.\/\.agents\/skills/);
  assert.equal(fs.readFileSync(path.join(opened.sourceRoot, "isp.mjs"), "utf8"), 'await import("../.isp/tools/isp.mjs");\n');
  assert.equal(fs.readFileSync(path.join(workspace, "isp.mjs"), "utf8"), 'await import("./.isp/tools/isp.mjs");\n');
  assert.match(fs.readFileSync(path.join(workspace, ".isp/tools/client.mjs"), "utf8"), /export const \{connection, localConnection, request, registerArtifact\}/);
  const guidance = fs.readFileSync(path.join(opened.sourceRoot, "AGENTS.md"), "utf8");
  openWorkspace(workspace, framework);
  assert.equal(fs.readFileSync(path.join(opened.sourceRoot, "AGENTS.md"), "utf8"), guidance);
});

test("workspace setup rejects linked generated-tool destinations before initializing or overwriting", t => {
  const parent = fixture(t), workspace = path.join(parent, "workspace"), outside = path.join(parent, "outside");
  fs.mkdirSync(workspace);
  put(outside, "isp.mjs", "External code must not change");
  fs.mkdirSync(path.join(workspace, ".isp"));
  fs.symlinkSync(outside, path.join(workspace, ".isp/tools"), process.platform === "win32" ? "junction" : "dir");
  const framework = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.throws(() => openWorkspace(workspace, framework), /cannot write through a linked path/);
  assert.equal(fs.readFileSync(path.join(outside, "isp.mjs"), "utf8"), "External code must not change");
  assert.equal(fs.existsSync(path.join(workspace, "project")), false);
});
