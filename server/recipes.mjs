import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, execFile, execFileSync} from 'node:child_process';
import {normalizeWorkspaceFolder, sourceRoot} from './project-layout.mjs';

// Recipes are reviewed source files. Only runRecipe executes them, locally, with
// literal argv. Parameters and program output are nonsecret inputs to the audit.
const MAX_RECIPE_BYTES = 256 * 1024;
const LOG_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT = 24 * 60 * 60 * 1000;
const reserved = new Set(['__proto__', 'prototype', 'constructor', 'workspace', 'sourceroot', 'rundir']);
const builtins = new Set(['workspace', 'sourceRoot', 'runDir']);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const own = (value, key) => Object.hasOwn(value, key);
const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (keys && !keys.includes(key)) throw Error(`Unsupported ${label} field: ${key}`);
  return value;
}
function text(value, label, max = 8000, empty = true) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!empty && !value.trim())) throw Error(`Invalid ${label}`);
  return value;
}
function boolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw Error(`${label} must be boolean`);
  return value;
}
function timeout(value = DEFAULT_TIMEOUT) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT) throw Error('timeoutMs must be an integer from 1 to 86400000');
  return value;
}
function id(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || reserved.has(value) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)) throw Error('Invalid recipe id; use a nonreserved lowercase name with hyphens');
  return value;
}
function parameterName(value) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) || reserved.has(value.toLowerCase())) throw Error(`Invalid or reserved parameter name: ${value}`);
}
function template(value, names, label) {
  text(value, label);
  const remaining = value.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (match, name) => {
    if (!builtins.has(name) && !names.has(name)) throw Error(`Unknown placeholder ${match} in ${label}`);
    return '';
  });
  if (remaining.includes('{{') || remaining.includes('}}')) throw Error(`Malformed placeholder in ${label}`);
  return value;
}
function relativeSyntax(value, label, dot = false) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw Error(`${label} must be a relative path`);
  const parts = value.replaceAll('\\', '/').split('/');
  for (const part of parts) {
    if (part === '.' && dot) continue;
    if (!part || part === '..' || /[\x00-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) throw Error(`Unsafe ${label}`);
    if (['.isp', '.git'].includes(part.toLowerCase())) throw Error(`${label} cannot access .isp or .git state`);
  }
  return parts.join(path.sep);
}
function safePath(base, relative, label = 'path', dot = false) {
  const target = path.resolve(base, relativeSyntax(relative, label, dot));
  const rel = path.relative(base, target);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw Error(`${label} must remain inside its root`);
  let current = base;
  for (const part of [null, ...rel.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    if (exists(current) && fs.lstatSync(current).isSymbolicLink()) throw Error(`Linked ${label} paths are not supported`);
  }
  return target;
}
function context(workspace) {
  const root = normalizeWorkspaceFolder(workspace);
  return {workspace: root, sourceRoot: sourceRoot(root)};
}
function recipeFile(ctx, recipeId) {
  return safePath(ctx.sourceRoot, `.isp-recipes/${id(recipeId)}.json`, 'recipe');
}

export function validateRecipe(input) {
  object(input, 'recipe', ['version', 'id', 'title', 'description', 'executable', 'args', 'cwd', 'blockIds', 'parameters', 'expectedOutputs', 'timeoutMs']);
  if (input.version !== 1) throw Error('Unsupported recipe version; expected 1');
  const parameters = Object.create(null);
  object(input.parameters ?? {}, 'parameters');
  if (Object.keys(input.parameters ?? {}).length > 64) throw Error('At most 64 parameters are supported');
  for (const [name, raw] of Object.entries(input.parameters ?? {})) {
    parameterName(name);
    object(raw, 'parameter', ['description', 'required', 'default']);
    const item = {description: text(raw.description ?? '', 'parameter description', 2000), required: boolean(raw.required, false, 'required')};
    if (own(raw, 'default')) item.default = text(raw.default, 'parameter default');
    parameters[name] = item;
  }
  const names = new Set(Object.keys(parameters));
  const executable = template(text(input.executable, 'executable', 8000, false), names, 'executable');
  if (/[\r\n]/.test(executable)) throw Error('Executable must be one direct command');
  const cwd = template(input.cwd ?? '.', names, 'cwd');
  // Built-in roots are absolute; cwd is deliberately source-relative.
  relativeSyntax(cwd.replace(/\{\{[A-Za-z][A-Za-z0-9_]*\}\}/g, 'parameter'), 'cwd', true);
  if (!Array.isArray(input.args) || input.args.length > 256) throw Error('args must be an array of at most 256 strings');
  const args = input.args.map(value => template(value, names, 'argument'));
  const blockIds = input.blockIds ?? [];
  if (!Array.isArray(blockIds) || blockIds.length > 200) throw Error('blockIds must be an array of at most 200 strings');
  for (const block of blockIds) text(block, 'block id', 200, false);
  if (new Set(blockIds).size !== blockIds.length) throw Error('Duplicate blockIds');
  const outputs = input.expectedOutputs ?? [];
  if (!Array.isArray(outputs) || outputs.length > 100) throw Error('expectedOutputs must be an array of at most 100 paths');
  const expectedOutputs = outputs.map(raw => {
    const item = typeof raw === 'string' ? {path: raw} : object(raw, 'expected output', ['path', 'description', 'required']);
    const file = template(text(item.path, 'expected output path', 8000, false), names, 'expected output');
    relativeSyntax(file.replace(/\{\{[A-Za-z][A-Za-z0-9_]*\}\}/g, 'parameter'), 'expected output');
    return {path: file, description: text(item.description ?? '', 'output description', 2000), required: boolean(item.required, true, 'output required')};
  });
  const result = {version: 1, id: id(input.id), title: text(input.title, 'title', 200, false), description: text(input.description ?? '', 'description', 12000), executable, args, cwd, blockIds: [...blockIds], parameters, expectedOutputs, timeoutMs: timeout(input.timeoutMs)};
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RECIPE_BYTES) throw Error('Recipe exceeds 256 KiB');
  return result;
}

export function readRecipe(workspace, recipeId) {
  const ctx = context(workspace), file = recipeFile(ctx, recipeId);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_RECIPE_BYTES) throw Error('Recipe must be a regular JSON file of at most 256 KiB');
  const bytes = fs.readFileSync(file), recipe = validateRecipe(JSON.parse(bytes.toString('utf8')));
  if (recipe.id !== recipeId) throw Error('Recipe id does not match its file name');
  return {recipe, hash: digest(bytes), path: file};
}

export function listRecipes(workspace) {
  const ctx = context(workspace), directory = safePath(ctx.sourceRoot, '.isp-recipes', 'recipe directory');
  if (!exists(directory)) return [];
  return fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => readRecipe(ctx.workspace, name.slice(0, -5)));
}

/** expectedHash:null creates; replacing requires the exact hash returned by readRecipe. */
export function saveRecipe(workspace, input, options = {}) {
  object(options, 'save options', ['expectedHash']);
  if (!own(options, 'expectedHash') || (options.expectedHash !== null && !/^[a-f0-9]{64}$/.test(options.expectedHash))) throw Error('expectedHash is required (null for a new recipe)');
  const recipe = validateRecipe(input), ctx = context(workspace), file = recipeFile(ctx, recipe.id);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const lock = safePath(ctx.sourceRoot, `.isp-recipes/.${recipe.id}.lock`, 'recipe lock');
  let handle;
  try { handle = fs.openSync(lock, 'wx'); } catch (error) { if (error.code === 'EEXIST') throw Error('Recipe is being saved; retry after the current save completes'); throw error; }
  const temporary = safePath(ctx.sourceRoot, `.isp-recipes/.${recipe.id}-${crypto.randomUUID()}.tmp`, 'recipe temporary file');
  try {
    const prior = exists(file) ? readRecipe(ctx.workspace, recipe.id) : null;
    if ((prior?.hash ?? null) !== options.expectedHash) throw Error('Recipe changed; read it again before saving');
    fs.writeFileSync(temporary, JSON.stringify(recipe, null, 2) + '\n', {flag: 'wx'});
    recipeFile(ctx, recipe.id);
    fs.renameSync(temporary, file);
    return readRecipe(ctx.workspace, recipe.id);
  } finally {
    fs.closeSync(handle);
    if (exists(temporary)) fs.unlinkSync(temporary);
    fs.unlinkSync(lock);
  }
}

function substitute(value, values) {
  return value.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, name) => {
    if (!own(values, name)) throw Error(`Missing parameter: ${name}`);
    return values[name];
  });
}
function outputPath(ctx, value) {
  // Only an expanded built-in/parameter may supply an absolute path; the saved
  // template itself was checked as relative. Every result remains in workspace.
  if (!path.isAbsolute(value) && (path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value))) throw Error('Expected output must remain inside the workspace');
  const relative = path.isAbsolute(value) ? path.relative(ctx.workspace, value) : value;
  return safePath(ctx.workspace, relative, 'expected output');
}
function executablePath(ctx, value) {
  text(value, 'executable', 8000, false);
  if (/[\r\n]/.test(value)) throw Error('Executable must be one direct command');
  if (/\.(cmd|bat)$/i.test(value)) throw Error('Direct .cmd/.bat execution is unsupported; explicitly choose cmd.exe and its arguments');
  if (path.isAbsolute(value)) return value;
  if (path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw Error('Invalid executable path');
  if (/[\\/]/.test(value)) return safePath(ctx.sourceRoot, value, 'executable', true);
  return value;
}
function sourceIdentity(ctx) {
  const identity = {gitHead: null, gitDirty: null, gitDiffSha256: null, graphSha256: null};
  const git = args => execFileSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {cwd: ctx.sourceRoot, encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0'}}).trim();
  try {
    if (samePath(git(['rev-parse', '--show-toplevel']), ctx.sourceRoot)) {
      try { identity.gitHead = git(['rev-parse', 'HEAD']); } catch {}
      identity.gitDirty = !!git(['status', '--porcelain', '--untracked-files=no']);
      identity.gitDiffSha256 = digest(git(['diff', '--no-ext-diff', '--no-textconv', '--binary', ...(identity.gitHead ? ['HEAD'] : []), '--', '.']));
    }
  } catch {}
  try {
    const graph = safePath(ctx.sourceRoot, 'graph.json', 'graph');
    if (fs.statSync(graph).size <= 8 * 1024 * 1024) identity.graphSha256 = digest(fs.readFileSync(graph));
  } catch {}
  return identity;
}

/** Read-only preview. Its runDir is illustrative; runRecipe reserves a fresh UUID. */
export function planRecipeRun(workspace, recipeId, options = {}) {
  object(options, 'run options', ['parameters', 'timeoutMs', 'expectedHash']);
  const ctx = context(workspace), saved = readRecipe(ctx.workspace, recipeId), recipe = saved.recipe;
  if (own(options, 'expectedHash') && options.expectedHash !== saved.hash) throw Error('Recipe changed; inspect it again before running');
  const overrides = object(options.parameters ?? {}, 'parameter values');
  for (const [name, value] of Object.entries(overrides)) {
    parameterName(name);
    if (!own(recipe.parameters, name)) throw Error(`Unknown parameter: ${name}`);
    text(value, 'parameter value');
  }
  const runId = crypto.randomUUID(), runDir = safePath(ctx.workspace, `tmp/recipe-runs/${runId}`, 'run directory');
  const values = Object.assign(Object.create(null), {workspace: ctx.workspace, sourceRoot: ctx.sourceRoot, runDir});
  for (const [name, definition] of Object.entries(recipe.parameters)) {
    if (own(overrides, name)) values[name] = overrides[name];
    else if (own(definition, 'default')) values[name] = definition.default;
    else if (definition.required) throw Error(`Missing required parameter: ${name}`);
  }
  const cwd = safePath(ctx.sourceRoot, substitute(recipe.cwd, values), 'cwd', true);
  if (!fs.statSync(cwd).isDirectory()) throw Error('cwd must be an existing source directory');
  const expectedOutputs = recipe.expectedOutputs.map(item => {
    const absolutePath = outputPath(ctx, substitute(item.path, values));
    const relative = path.relative(runDir, absolutePath);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) && ['manifest.json', 'stdout.log', 'stderr.log'].includes(relative.toLowerCase()))) throw Error('Expected output conflicts with runner metadata');
    return {...item, path: path.relative(ctx.workspace, absolutePath).replaceAll('\\', '/'), absolutePath};
  });
  if (new Set(expectedOutputs.map(item => process.platform === 'win32' ? item.absolutePath.toLowerCase() : item.absolutePath)).size !== expectedOutputs.length) throw Error('Duplicate expected output paths');
  return {version: 1, runId, recipeId: recipe.id, recipeHash: saved.hash, recipePath: saved.path, title: recipe.title, blockIds: recipe.blockIds, workspace: ctx.workspace, sourceRoot: ctx.sourceRoot, runDir, executable: executablePath(ctx, substitute(recipe.executable, values)), args: recipe.args.map(value => substitute(value, values)), cwd, expectedOutputs, timeoutMs: timeout(options.timeoutMs ?? recipe.timeoutMs), shell: false, logLimitBytes: LOG_BYTES};
}

async function outputRecord(ctx, item) {
  try {
    const file = outputPath(ctx, item.absolutePath), stat = fs.statSync(file);
    if (!stat.isFile()) return {exists: true, valid: false, error: 'Expected output is not a regular file'};
    const hash = crypto.createHash('sha256');
    // Streaming bounds memory even for RAW outputs larger than RAM.
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    outputPath(ctx, item.absolutePath);
    const after = fs.statSync(file);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) return {exists: true, valid: false, error: 'Output changed while being recorded'};
    return {exists: true, valid: true, size: stat.size, sha256: hash.digest('hex'), modifiedAt: stat.mtime.toISOString()};
  } catch (error) {
    if (error.code === 'ENOENT') return {exists: false, valid: false};
    return {exists: false, valid: false, error: error.message};
  }
}
function tailCollector() {
  let tail = Buffer.alloc(0), bytes = 0;
  return {
    append(chunk) { bytes += chunk.length; tail = chunk.length >= LOG_BYTES ? Buffer.from(chunk.subarray(-LOG_BYTES)) : Buffer.concat([tail.subarray(Math.max(0, tail.length + chunk.length - LOG_BYTES)), chunk]); },
    result() {
      let start = 0;
      while (start < tail.length && (tail[start] & 0xc0) === 0x80) start++;
      const decoded = Buffer.from(tail.subarray(start).toString('utf8'));
      let offset = Math.max(0, decoded.length - LOG_BYTES);
      while (offset < decoded.length && (decoded[offset] & 0xc0) === 0x80) offset++;
      return {bytes, capturedBytes: decoded.length - offset, truncated: bytes > tail.length || start > 0 || offset > 0, tail: decoded.subarray(offset).toString('utf8')};
    },
  };
}
function cleanupTree(child, startedAt, exitedAt) {
  if (!child.pid) return Promise.resolve(null);
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') return Promise.resolve(error.message); }
    return Promise.resolve(null);
  }
  const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  return new Promise(resolve => {
    const fallback = () => {
      // An exited parent can leave a child holding its pipes. Query only this
      // parent's descendants; no user arguments are interpreted as shell code.
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const upperBound = exitedAt || new Date().toISOString();
      const code = `$ErrorActionPreference='Stop'; $children=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Where-Object { $_.CreationDate.ToUniversalTime() -ge [DateTime]::Parse('${startedAt}').ToUniversalTime() -and $_.CreationDate.ToUniversalTime() -le [DateTime]::Parse('${upperBound}').ToUniversalTime() }); if ($children.Count -eq 0) { exit 2 }; $failed=$false; $children | ForEach-Object { & '${taskkill.replaceAll("'", "''")}' /PID $_.ProcessId /T /F | Out-Null; if ($LASTEXITCODE -ne 0) { $failed=$true } }; if ($failed) { exit 1 }`;
      execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], {windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024}, fallbackError => {
        try { child.kill('SIGKILL'); } catch {}
        resolve(fallbackError ? 'Process-tree cleanup could not be confirmed' : null);
      });
    };
    // Avoid targeting a recycled PID after the directly spawned child exited.
    if (child.exitCode !== null || child.signalCode !== null) return fallback();
    execFile(taskkill, ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024}, error => {
      if (!error) return resolve(null);
      fallback();
    });
  });
}
function execute(plan) {
  return new Promise(resolve => {
    const stdout = tailCollector(), stderr = tailCollector();
    let child, timer, fallback, cleanup = Promise.resolve(null), finished = false, timedOut = false, forcedClose = false, spawnError = null, exitCode = null, signal = null, exitedAt = null;
    const processStartedAt = new Date().toISOString();
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(fallback);
      const cleanupError = await cleanup || (forcedClose ? 'Process pipes stayed open after cleanup; descendant termination could not be confirmed' : null);
      resolve({exitCode, signal, timedOut, spawnError, cleanupError, stdout: stdout.result(), stderr: stderr.result()});
    };
    try { child = spawn(plan.executable, plan.args, {cwd: plan.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']}); }
    catch (error) { spawnError = error.message; finish(); return; }
    child.stdout.on('data', chunk => stdout.append(chunk));
    child.stderr.on('data', chunk => stderr.append(chunk));
    child.on('error', error => { spawnError = error.message; });
    child.on('exit', (code, value) => { exitCode = code; signal = value; exitedAt = new Date().toISOString(); });
    child.on('close', finish);
    timer = setTimeout(() => {
      timedOut = true;
      cleanup = cleanupTree(child, processStartedAt, exitedAt);
      // Broken descendants must not keep a timed-out CLI pending indefinitely.
      fallback = setTimeout(() => { forcedClose = true; child.stdout.destroy(); child.stderr.destroy(); finish(); }, 12_000);
    }, plan.timeoutMs);
  });
}
function writeRunFile(plan, name, contents, exclusive = false) {
  const file = safePath(plan.workspace, path.relative(plan.workspace, path.join(plan.runDir, name)), 'run record');
  if (exists(file) && !fs.lstatSync(file).isFile()) throw Error('Run record must be a regular file');
  fs.writeFileSync(file, contents, {flag: exclusive ? 'wx' : 'w'});
  return file;
}

export async function runRecipe(workspace, recipeId, options = {}) {
  const plan = planRecipeRun(workspace, recipeId, options), ctx = {workspace: plan.workspace, sourceRoot: plan.sourceRoot};
  const before = await Promise.all(plan.expectedOutputs.map(item => outputRecord(ctx, item)));
  const identity = sourceIdentity(ctx), startedAt = new Date().toISOString(), start = performance.now();
  fs.mkdirSync(path.dirname(plan.runDir), {recursive: true});
  safePath(plan.workspace, path.relative(plan.workspace, plan.runDir), 'run directory');
  fs.mkdirSync(plan.runDir);
  const manifestPath = path.join(plan.runDir, 'manifest.json');
  const initial = {...plan, status: 'running', startedAt, manifestPath, sourceIdentity: identity};
  writeRunFile(plan, 'manifest.json', JSON.stringify(initial, null, 2) + '\n', true);
  writeRunFile(plan, 'stdout.log', '', true);
  writeRunFile(plan, 'stderr.log', '', true);
  const execution = await execute(plan), endedAt = new Date().toISOString(), durationMs = Math.round(performance.now() - start);
  const outputs = await Promise.all(plan.expectedOutputs.map(async (item, index) => {
    const record = await outputRecord(ctx, item), prior = before[index];
    const changed = record.valid && (!prior.exists || (prior.valid && prior.sha256 !== record.sha256));
    return {...item, ...record, existedBefore: prior.exists, generated: !!changed, ...(prior.valid ? {previousSha256: prior.sha256} : {}), satisfied: !!changed};
  }));
  const afterIdentity = sourceIdentity(ctx);
  const comparable = identity.gitDiffSha256 !== null || identity.gitHead !== null || identity.graphSha256 !== null;
  const sourceChanged = comparable ? JSON.stringify(identity) !== JSON.stringify(afterIdentity) : null;
  const success = !execution.timedOut && !execution.spawnError && !execution.cleanupError && execution.exitCode === 0 && outputs.every(item => !item.required || item.satisfied);
  const manifest = {...initial, ...execution, status: success ? 'succeeded' : execution.timedOut ? 'timed_out' : 'failed', endedAt, durationMs, outputs, sourceIdentityAfter: afterIdentity, sourceChanged};
  manifest.stdout.path = writeRunFile(plan, 'stdout.log', manifest.stdout.tail);
  manifest.stderr.path = writeRunFile(plan, 'stderr.log', manifest.stderr.tail);
  writeRunFile(plan, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
