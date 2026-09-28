import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const markerName = "workspace.json";
const journalName = "layout-migration.json";
const nameKey = name => process.platform === "win32" ? name.toLowerCase() : name;
const localNames = new Set([".isp", "data", "tmp", "artifacts", ".venv", "venv", "node_modules"].map(nameKey));
const guidanceNames = new Set([".agents", ".claude", "AGENTS.md", "CLAUDE.md", "isp.cmd", "isp.mjs"].map(nameKey));
const samePath = (a, b) => process.platform === "win32"
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);
const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };

function ordinaryDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${label} must be a regular folder, not a symlink: ${directory}`);
}

function rootFolder(workspace) {
  const root = normalizeWorkspaceFolder(workspace);
  ordinaryDirectory(root, "Workspace");
  const state = path.join(root, ".isp");
  if (exists(state)) ordinaryDirectory(state, "Workspace state");
  return root;
}

/** Selecting an explicitly configured source folder opens its owning workspace. */
export function normalizeWorkspaceFolder(folder) {
  const root = fs.realpathSync(folder);
  ordinaryDirectory(root, "Workspace");
  const parent = path.dirname(root);
  if (parent !== root && nameKey(path.basename(root)) === "project" && exists(path.join(parent, ".isp", markerName))) {
    ordinaryDirectory(path.join(parent, ".isp"), "Workspace state");
    if (readMarker(parent) && samePath(path.join(parent, "project"), root)) return parent;
  }
  return root;
}

function readMarker(root) {
  const file = path.join(root, ".isp", markerName);
  if (!exists(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Workspace layout marker must not be a symlink.");
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error("Invalid .isp/workspace.json. Restore the layout marker before opening this workspace."); }
  if (value.version !== 1 || value.sourceRoot !== "project")
    throw new Error("Unsupported workspace layout. Expected sourceRoot: project in .isp/workspace.json.");
  return value;
}

/** Read-only: old workspaces remain usable until openWorkspace explicitly migrates them. */
export function sourceRoot(workspace) {
  const root = rootFolder(workspace);
  const marked = readMarker(root);
  const project = path.join(root, "project");
  if (marked) {
    ordinaryDirectory(project, "Project source");
    return project;
  }
  if (exists(path.join(root, ".isp", journalName)))
    throw new Error("Workspace layout migration is incomplete. Reopen the workspace to resume it.");
  if (!exists(path.join(root, "graph.json")) && !exists(path.join(root, ".git")) && exists(path.join(project, "graph.json"))) {
    ordinaryDirectory(project, "Project source");
    return project;
  }
  return root;
}

function git(cwd, args, optional = false) {
  try {
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd, encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
  } catch (error) {
    if (optional && error.status === 1) return "";
    throw new Error(`Cannot prepare project Git repository: ${String(error.stderr || error.message).trim()}`);
  }
}

function checkGit(root, moving = true) {
  const directory = path.join(root, ".git");
  if (!exists(directory)) return false;
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
    throw new Error("Linked Git worktrees/submodules cannot be moved automatically. Use an independent workspace clone.");
  for (const name of ["commondir", "worktrees", "modules", "index.lock", "objects/info/alternates"])
    if (exists(path.join(directory, name)))
      throw new Error(`Git layout requires manual migration (${name}); no workspace files were moved.`);
  if (git(root, ["config", "--get", "core.worktree"], true).trim())
    throw new Error("Git core.worktree is configured; automatic source relocation is unsafe.");
  if (!samePath(fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()), root))
    throw new Error("The workspace must own its Git repository; an ancestor repository cannot be migrated.");
  const entries = git(root, ["ls-files", "--stage", "-z"]).split("\0").filter(Boolean);
  if (entries.some(entry => entry.startsWith("160000 ")))
    throw new Error("Git submodules require manual migration; no workspace files were moved.");
  // Splitting tracked local data would change the index/worktree relationship.
  // Refuse rather than silently delete it from the new source repository.
  const local = entries.map(entry => entry.slice(entry.indexOf("\t") + 1))
    .find(file => localNames.has(nameKey(file.split("/")[0])));
  if (moving && local) throw new Error(`Local data is tracked by Git (${local}). Separate local state, data, temporary files and environments from Git before relocating this workspace.`);
  return true;
}

function noCopyLinks(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error(`Cannot copy linked agent guidance during migration: ${directory}`);
  if (stat.isDirectory()) for (const entry of fs.readdirSync(directory)) noCopyLinks(path.join(directory, entry));
}

function copyGuidance(from, to, state) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) throw new Error(`Linked migration guidance: ${from}`);
  if (stat.isDirectory()) {
    if (!exists(to)) fs.mkdirSync(to);
    ordinaryDirectory(to, "Copied agent guidance");
    for (const name of fs.readdirSync(from)) copyGuidance(path.join(from, name), path.join(to, name), state);
    return;
  }
  if (!stat.isFile()) throw new Error(`Unsupported migration guidance: ${from}`);
  if (exists(to)) {
    const copied = fs.lstatSync(to);
    if (!copied.isFile() || copied.isSymbolicLink() || !fs.readFileSync(from).equals(fs.readFileSync(to)))
      throw new Error(`Migration guidance differs between ${from} and ${to}; both copies were preserved. Resolve before reopening.`);
    return;
  }
  // The destination appears only after the full file is copied. A process crash
  // can leave an unused local temp file, never an apparently completed partial copy.
  const temporary = path.join(state, `.layout-copy-${crypto.randomUUID()}.tmp`);
  try {
    fs.copyFileSync(from, temporary, fs.constants.COPYFILE_EXCL);
    fs.utimesSync(temporary, stat.atime, stat.mtime);
    fs.renameSync(temporary, to);
  } finally {
    if (exists(temporary)) fs.unlinkSync(temporary);
  }
}

/** A read-only migration preview; call this before stopping a live workspace server. */
export function planProjectLayout(workspace) {
  const root = rootFolder(workspace);
  const project = path.join(root, "project");
  if (readMarker(root)) {
    ordinaryDirectory(project, "Project source");
    return { version: 1, workspace: root, sourceRoot: project, kind: "ready", actions: [] };
  }
  if (exists(path.join(root, ".isp", journalName)))
    return { version: 1, workspace: root, sourceRoot: project, kind: "resume", actions: [] };
  if (exists(project)) {
    ordinaryDirectory(project, "Project source");
    if (!exists(path.join(root, ".git")) && !exists(path.join(root, "graph.json")) && exists(path.join(project, "graph.json"))) {
      checkGit(project, false);
      return { version: 1, workspace: root, sourceRoot: project, kind: "adopt", actions: [] };
    }
    throw new Error("A project/ folder already exists. Rename it or restore .isp/workspace.json; no files were moved.");
  }
  // Check availability even for brand-new workspaces before any filesystem changes.
  git(root, ["--version"]);
  const hasGit = checkGit(root);
  const actions = [];
  for (const name of fs.readdirSync(root)) {
    if (localNames.has(nameKey(name))) continue;
    if (guidanceNames.has(nameKey(name))) {
      if (hasGit) {
        noCopyLinks(path.join(root, name));
        actions.push({ name, kind: "copy" });
      }
      continue;
    }
    if (fs.lstatSync(path.join(root, name)).isSymbolicLink())
      throw new Error(`Linked workspace entry requires manual migration: ${name}`);
    actions.push({ name, kind: "move" });
  }
  // Moving Git last keeps the old worktree inspectable throughout most of migration.
  actions.sort((a, b) => Number(nameKey(a.name) === ".git") - Number(nameKey(b.name) === ".git"));
  return { version: 1, workspace: root, sourceRoot: project, kind: hasGit ? "migrate" : "initialize", actions };
}

function writeJson(file, value) {
  if (exists(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`Cannot write linked layout state: ${file}`);
  const temporary = file + ".tmp";
  if (exists(temporary) && fs.lstatSync(temporary).isSymbolicLink()) throw new Error(`Cannot write linked layout state: ${temporary}`);
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
}

function validJournal(value, root) {
  if (value?.version !== 1 || !samePath(value.workspace || "", root) || value.sourceRoot !== "project" || !Array.isArray(value.actions))
    throw new Error("Invalid workspace migration journal; no further files were moved.");
  const names = new Set();
  for (const action of value.actions) {
    if (!action || !["move", "copy"].includes(action.kind) || typeof action.name !== "string" ||
        !action.name || action.name === "." || action.name === ".." || /[\\/:]/.test(action.name) ||
        nameKey(action.name) === "project" || localNames.has(nameKey(action.name)) || names.has(nameKey(action.name)) ||
        (action.kind === "copy" && !guidanceNames.has(nameKey(action.name))))
      throw new Error("Unsafe workspace migration journal; no further files were moved.");
    names.add(nameKey(action.name));
  }
  return value;
}

/** Move a legacy independent repository without rewriting commits or the staging index. */
export function ensureProjectLayout(workspace) {
  const root = rootFolder(workspace);
  const state = path.join(root, ".isp");
  const project = path.join(root, "project");
  const journalFile = path.join(state, journalName);
  const markerFile = path.join(state, markerName);
  if (readMarker(root)) {
    ordinaryDirectory(project, "Project source");
    if (!checkGit(project, false)) git(project, ["init", "-b", "main"]);
    if (exists(journalFile)) {
      validJournal(JSON.parse(fs.readFileSync(journalFile, "utf8")), root);
      fs.unlinkSync(journalFile);
    }
    return project;
  }
  let journal;
  if (exists(journalFile)) {
    if (fs.lstatSync(journalFile).isSymbolicLink()) throw new Error("Migration journal must not be a symlink.");
    journal = validJournal(JSON.parse(fs.readFileSync(journalFile, "utf8")), root);
  } else {
    const plan = planProjectLayout(root);
    if (plan.kind === "adopt") {
      fs.mkdirSync(state, { recursive: true });
      if (!exists(path.join(project, ".git"))) git(project, ["init", "-b", "main"]);
      writeJson(markerFile, { version: 1, sourceRoot: "project" });
      return project;
    }
    journal = { version: 1, workspace: root, sourceRoot: "project", actions: plan.actions };
    fs.mkdirSync(state, { recursive: true });
    writeJson(journalFile, journal);
  }
  if (!exists(project)) fs.mkdirSync(project);
  ordinaryDirectory(project, "Project source");
  for (const action of journal.actions) {
    const from = path.join(root, action.name), to = path.join(project, action.name);
    if (action.kind === "move") {
      if (exists(from) && exists(to)) throw new Error(`Migration collision for ${action.name}; both copies were preserved. Resolve before reopening.`);
      if (exists(from)) {
        if (fs.lstatSync(from).isSymbolicLink()) throw new Error(`Linked migration source: ${action.name}`);
        fs.renameSync(from, to);
      } else if (!exists(to)) throw new Error(`Missing migration source and destination: ${action.name}`);
    } else {
      noCopyLinks(from);
      // Copies preserve tracked historical guidance while current workspace skills remain outside Git.
      if (exists(to)) noCopyLinks(to);
      copyGuidance(from, to, state);
    }
  }
  if (!exists(path.join(project, ".git"))) git(project, ["init", "-b", "main"]);
  writeJson(markerFile, { version: 1, sourceRoot: "project" });
  // Keep an audit of paths moved, but no duplicate source tree or Git object database.
  writeJson(path.join(state, "layout-migrated.json"), { ...journal, migratedAt: new Date().toISOString() });
  fs.unlinkSync(journalFile);
  return project;
}
