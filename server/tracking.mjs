import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { validateGraph } from './model.mjs';
import { sourceRoot } from './project-layout.mjs';

const execute = promisify(execFile);
const queues = new Map();
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const refsSchema = z.array(z.object({ blockId: identifier.nullable(), jobId: identifier }).strict()).max(200);
const checkpointInput = z.object({ title: z.string().trim().min(1).max(200), kind: z.enum(['manual', 'baseline', 'result', 'safety']).default('manual') }).strict();
const attemptInput = z.object({
  title: z.string().trim().min(1).max(200), approach: z.string().max(12000).default(''),
  jobRefs: refsSchema.default([]), blockIds: z.array(identifier).max(200).default([]),
  inputConditions: z.string().max(12000).default(''), baselineCheckpointId: identifier.nullable().optional(),
}).strict();
const updateInput = z.object({
  expectedUpdatedAt: z.iso.datetime().optional(),
  title: z.string().trim().min(1).max(200).optional(), approach: z.string().max(12000).optional(),
  inputConditions: z.string().max(12000).optional(), summary: z.string().max(12000).optional(),
  status: z.enum(['in_progress', 'completed', 'failed', 'cancelled']).optional(),
  validation: z.array(z.string().max(4000)).max(100).optional(), artifactIds: z.array(identifier).max(200).optional(),
  resultCheckpointId: identifier.nullable().optional(),
}).strict();
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const localOnly = file => /(^|\/)(\.isp|tmp|node_modules)(\/|$)|(^|\/)artifacts\/generated(\/|$)/.test(file);
const sourcePaths = ['.', ':(exclude)**/.isp/**', ':(exclude).isp/**', ':(exclude)**/tmp/**', ':(exclude)tmp/**', ':(exclude)**/node_modules/**', ':(exclude)node_modules/**', ':(exclude)artifacts/generated/**'];
const split = value => value.split('\0').filter(Boolean);

async function locked(workspace, operation) {
  const key = path.resolve(workspace);
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(key, next);
  try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}

async function git(cwd, args, extraEnv = {}) {
  try {
    const { stdout } = await execute('git', ['-c', 'core.quotepath=false', ...args], {
      cwd, windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...extraEnv },
    });
    return stdout;
  } catch (error) { throw new Error(String(error.stderr || error.message).trim()); }
}

function safePath(root, relative, allowMissing = true) {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..' || p === '.git')) throw new Error('Unsafe source path.');
  const full = path.resolve(root, relative);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Source path leaves the project.');
  let cursor = root;
  for (const part of relative.split(/[\\/]/)) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (error) { if (error.code === 'ENOENT' && allowMissing) return full; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported in checkpoints: ${relative}`);
  }
  return full;
}

function trackingFile(workspace) {
  const root = path.resolve(workspace);
  const file = safePath(root, '.isp/tracking.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}
function readState(workspace) {
  const file = trackingFile(workspace);
  if (!fs.existsSync(file)) return { schemaVersion: 1, attempts: [], checkpoints: [], acceptedAttemptId: null, lastAttemptId: null };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.attempts) || !Array.isArray(value.checkpoints)) throw new Error('Unsupported or damaged work tracking file.');
  return value;
}
function writeState(workspace, state) {
  const file = trackingFile(workspace), tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
async function repository(workspace) {
  const root = sourceRoot(workspace);
  if (!fs.existsSync(path.join(root, '.git'))) throw new Error('The source folder needs its own Git repository.');
  const actual = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  if (fs.realpathSync(actual) !== fs.realpathSync(root)) throw new Error('A parent repository cannot store project checkpoints.');
  return root;
}
async function optionalGit(root, args) { try { return (await git(root, args)).trim(); } catch { return null; } }

async function inspectSource(workspace) {
  const root = await repository(workspace);
  const headHash = await optionalGit(root, ['rev-parse', '--verify', 'HEAD']);
  const branch = await optionalGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const tracked = split(await git(root, ['ls-files', '-z']));
  if (tracked.some(localOnly)) throw new Error('Local state, temporary files or generated artifacts are tracked by Git. Move them out before creating checkpoints.');
  if ((await git(root, ['ls-files', '-u'])).trim()) throw new Error('Resolve Git conflicts before creating a checkpoint.');
  if ((await git(root, ['ls-files', '-v'])).split('\n').some(line => /^[Sa-z] /.test(line))) throw new Error('Sparse, skip-worktree or assume-unchanged files are not supported in checkpoints.');
  const candidates = split(await git(root, ['ls-files', '-c', '-o', '--exclude-standard', '-z']));
  for (const file of new Set(candidates.filter(file => !localOnly(file)))) safePath(root, file);
  const indexTreeHash = (await git(root, ['write-tree'])).trim();
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim();
  const index = path.join(gitDir, `isp-index-${crypto.randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  let treeHash;
  try {
    await git(root, ['read-tree', indexTreeHash], env);
    await git(root, ['add', '-u'], env);
    const untracked = split(await git(root, ['ls-files', '-o', '--exclude-standard', '-z'])).filter(file => !localOnly(file));
    for (let offset = 0; offset < untracked.length; offset += 80) {
      await git(root, ['add', '--', ...untracked.slice(offset, offset + 80).map(file => `:(literal)${file}`)], env);
    }
    treeHash = (await git(root, ['write-tree'], env)).trim();
    const entries = split(await git(root, ['ls-tree', '-r', '-z', treeHash]));
    if (entries.some(entry => /^(120000|160000) /.test(entry))) throw new Error('Symlinks and submodules are not supported in checkpoints.');
    validateGraph(JSON.parse(await git(root, ['show', `${treeHash}:graph.json`])));
  } finally {
    for (const file of [index, `${index}.lock`]) if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...sourcePaths]);
  const snapshot = sha(JSON.stringify({ root, headHash, branch, treeHash, indexTreeHash, status }));
  return { available: true, root, headHash, branch, treeHash, indexTreeHash, dirty: !!status, snapshot };
}
function checkpointById(state, id) {
  identifier.parse(id);
  const checkpoint = state.checkpoints.find(item => item.id === id);
  if (!checkpoint) throw new Error('Checkpoint not found.');
  if (!/^[a-f0-9]{40,64}$/.test(checkpoint.hash)) throw new Error('Invalid checkpoint commit.');
  return checkpoint;
}
async function checkpointAvailable(root, checkpoint) {
  return !!(root && /^[a-f0-9]{40,64}$/.test(checkpoint.hash) && await optionalGit(root, ['rev-parse', '--verify', `${checkpoint.hash}^{commit}`]));
}
async function createCheckpointInternal(workspace, state, input, inspected) {
  const data = checkpointInput.parse(input), current = inspected || await inspectSource(workspace);
  const id = crypto.randomUUID(), timestamp = now();
  const env = { GIT_AUTHOR_NAME: 'ISP Block Maker', GIT_AUTHOR_EMAIL: 'isp@localhost', GIT_COMMITTER_NAME: 'ISP Block Maker', GIT_COMMITTER_EMAIL: 'isp@localhost' };
  const parents = current.headHash ? ['-p', current.headHash] : [];
  const indexCommitHash = (await git(current.root, ['commit-tree', current.indexTreeHash, ...parents, '-m', `Checkpoint index: ${data.title}`], env)).trim();
  const hash = (await git(current.root, ['commit-tree', current.treeHash, ...parents, '-p', indexCommitHash, '-m', data.title], env)).trim();
  await git(current.root, ['update-ref', `refs/isp/checkpoints/${id}`, hash]);
  const checkpoint = { id, ...data, hash, treeHash: current.treeHash, indexTreeHash: current.indexTreeHash, indexCommitHash, createdAt: timestamp, sourceHead: current.headHash, sourceBranch: current.branch };
  state.checkpoints.unshift(checkpoint);
  writeState(workspace, state);
  return { ...checkpoint, available: true };
}
export async function createCheckpoint(workspace, input) {
  return locked(workspace, () => createCheckpointInternal(workspace, readState(workspace), input));
}
export async function listTracking(workspace, project) {
  const state = readState(workspace);
  let current, root;
  try { current = await inspectSource(workspace); root = current.root; }
  catch (error) { current = { available: false, reason: error.message, headHash: null, branch: null, treeHash: null, checkpointId: null, dirty: false, snapshot: null }; try { root = await repository(workspace); } catch {} }
  const checkpoints = await Promise.all(state.checkpoints.map(async checkpoint => ({ ...checkpoint, available: await checkpointAvailable(root, checkpoint) })));
  const matching = checkpoints.filter(checkpoint => checkpoint.available && checkpoint.treeHash === current.treeHash);
  current.checkpointId = matching.find(checkpoint => checkpoint.hash === current.headHash)?.id || matching[0]?.id || null;
  return { ...clone(state), checkpoints, current };
}
function validateLinks(project, input) {
  const blocks = new Map(project.blocks.map(block => [block.id, block]));
  for (const id of input.blockIds) if (!blocks.has(id)) throw new Error(`Block not found: ${id}`);
  const seen = new Set();
  const jobSnapshots = input.jobRefs.map(ref => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) throw new Error('Duplicate JOB reference.');
    seen.add(key);
    const scope = ref.blockId === null ? project.globalWork : blocks.get(ref.blockId);
    const job = scope?.jobs?.find(item => item.id === ref.jobId);
    if (!job) throw new Error(`JOB not found: ${ref.jobId}`);
    return { ...ref, job: clone(job) };
  });
  const blockIds = [...new Set([...input.blockIds, ...input.jobRefs.map(ref => ref.blockId).filter(Boolean)])];
  const parameterSnapshot = (blockIds.length ? blockIds.map(id => blocks.get(id)) : project.blocks).map(block => ({ blockId: block.id, parameters: clone(block.parameters || {}) }));
  return { blockIds, jobSnapshots, parameterSnapshot };
}
export async function createAttempt(workspace, project, input) {
  return locked(workspace, async () => {
    const data = attemptInput.parse(input), state = readState(workspace), links = validateLinks(project, data);
    let baseline;
    if (data.baselineCheckpointId) {
      baseline = checkpointById(state, data.baselineCheckpointId);
      const current = await inspectSource(workspace);
      if (!await checkpointAvailable(current.root, baseline)) throw new Error('The baseline checkpoint source is unavailable.');
      if (current.treeHash !== baseline.treeHash) throw new Error('The selected baseline differs from the current source. Restore it before starting this attempt.');
    } else baseline = await createCheckpointInternal(workspace, state, { title: `${data.title} · baseline`.slice(0, 200), kind: 'baseline' });
    const time = now(), attempt = { ...data, ...links, id: crypto.randomUUID(), baselineCheckpointId: baseline.id, resultCheckpointId: null, status: 'in_progress', summary: '', validation: [], artifactIds: [], createdAt: time, updatedAt: time };
    state.attempts.unshift(attempt); state.lastAttemptId = attempt.id;
    writeState(workspace, state); return clone(attempt);
  });
}
export async function updateAttempt(workspace, project, id, input) {
  return locked(workspace, async () => {
    identifier.parse(id);
    const parsed = updateInput.parse(input), { expectedUpdatedAt, ...data } = parsed, state = readState(workspace), attempt = state.attempts.find(item => item.id === id);
    if (!attempt) throw new Error('Attempt not found.');
    if (expectedUpdatedAt && attempt.updatedAt !== expectedUpdatedAt) throw new Error('This attempt changed elsewhere. Reload its latest record before saving.');
    if (attempt.status !== 'in_progress') throw new Error('Completed attempts are immutable. Start another attempt.');
    for (const artifactId of data.artifactIds || []) if (!project.artifacts?.some(artifact => artifact.id === artifactId)) throw new Error(`Artifact not found: ${artifactId}`);
    if (data.resultCheckpointId) {
      const checkpoint = checkpointById(state, data.resultCheckpointId);
      if (!await checkpointAvailable(await repository(workspace), checkpoint)) throw new Error('The result checkpoint source is unavailable.');
    }
    const next = { ...attempt, ...data, updatedAt: new Date(Math.max(Date.now(), Date.parse(attempt.updatedAt) + 1)).toISOString() };
    if (next.status === 'completed' && !next.summary.trim()) throw new Error('Add a result summary before completing the attempt.');
    if (next.status === 'completed' && !next.resultCheckpointId) next.resultCheckpointId = (await createCheckpointInternal(workspace, state, { title: `${next.title} · result`.slice(0, 200), kind: 'result' })).id;
    if (next.status !== 'in_progress') next.completedAt = now();
    Object.assign(attempt, next); state.lastAttemptId = id;
    writeState(workspace, state); return clone(attempt);
  });
}
export async function acceptAttempt(workspace, id) {
  return locked(workspace, async () => {
    identifier.parse(id);
    const state = readState(workspace), attempt = state.attempts.find(item => item.id === id);
    if (!attempt || attempt.status !== 'completed' || !attempt.resultCheckpointId) throw new Error('Only a completed attempt with a result checkpoint can be accepted.');
    checkpointById(state, attempt.resultCheckpointId);
    state.acceptedAttemptId = id; state.acceptedAt = now();
    writeState(workspace, state); return { acceptedAttemptId: id, attempt: clone(attempt) };
  });
}

async function graphAt(root, ref) { return validateGraph(JSON.parse(await git(root, ['show', `${ref}:graph.json`]))); }
async function differences(root, from, to) {
  const files = split(await git(root, ['diff', '--name-only', '-z', from, to, '--']));
  const stats = await git(root, ['diff', '--stat', from, to, '--']);
  const patch = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', from, to, '--']);
  const before = await graphAt(root, from), after = await graphAt(root, to), old = new Map(before.blocks.map(block => [block.id, block])), next = new Map(after.blocks.map(block => [block.id, block]));
  const blockChanges = [];
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const left = old.get(id), right = next.get(id), fields = [...new Set([...Object.keys(left || {}), ...Object.keys(right || {})])].filter(key => JSON.stringify(left?.[key]) !== JSON.stringify(right?.[key]));
    if (right?.implementation && files.includes(right.implementation.replaceAll('\\', '/'))) fields.push('implementation source');
    if (fields.length) blockChanges.push({ id, name: right?.name || left?.name, status: !left ? 'added' : !right ? 'removed' : 'modified', fields });
  }
  return { files, fileCount: files.length, stats: stats.slice(0, 18000), patch: patch.slice(0, 100000), truncated: patch.length > 100000, blockChanges };
}
export async function compareCheckpoints(workspace, fromId, toId) {
  const state = readState(workspace), from = checkpointById(state, fromId), to = checkpointById(state, toId), root = await repository(workspace);
  if (!await checkpointAvailable(root, from) || !await checkpointAvailable(root, to)) throw new Error('Checkpoint source is unavailable. Import its Git history to compare it.');
  return { from, to, ...await differences(root, from.hash, to.hash) };
}
async function targetSafety(root, checkpoint, current) {
  const entries = split(await git(root, ['ls-tree', '-r', '-z', checkpoint.hash]));
  const targetFiles = [];
  for (const entry of entries) {
    const [meta, file] = entry.split('\t');
    if (!meta.startsWith('100644 ') && !meta.startsWith('100755 ')) throw new Error('Checkpoint contains unsupported links or submodules.');
    if (localOnly(file)) throw new Error('Checkpoint contains local state or generated files.');
    safePath(root, file); targetFiles.push(file);
  }
  const sourceFiles = new Set(split(await git(root, ['ls-tree', '-r', '--name-only', '-z', current.treeHash])));
  for (const file of targetFiles) {
    const full = path.resolve(root, file);
    if (fs.existsSync(full) && !sourceFiles.has(file)) throw new Error(`A local ignored file or directory would be overwritten: ${file}`);
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/'), parentPath = path.resolve(root, parent);
      if (fs.existsSync(parentPath) && !fs.lstatSync(parentPath).isDirectory() && !sourceFiles.has(parent)) throw new Error(`A local file blocks the checkpoint: ${parent}`);
    }
  }
  await graphAt(root, checkpoint.hash);
}
export async function previewRestore(workspace, checkpointId) {
  const state = readState(workspace), checkpoint = checkpointById(state, checkpointId), current = await inspectSource(workspace);
  if (!await checkpointAvailable(current.root, checkpoint)) throw new Error('Checkpoint source is unavailable. Import its Git history to restore it.');
  let blockedReason = null;
  try { await targetSafety(current.root, checkpoint, current); } catch (error) { blockedReason = error.message; }
  const comparison = await differences(current.root, current.treeHash, checkpoint.hash);
  return { checkpoint: { ...checkpoint, available: true }, snapshot: current.snapshot, current, ...comparison, blockedReason };
}
export async function restoreCheckpoint(workspace, input, beforeSwitch = () => {}) {
  return locked(workspace, async () => {
    const data = z.object({ checkpointId: identifier, snapshot: z.string().regex(/^[a-f0-9]{64}$/), stopTerminals: z.boolean().optional() }).strict().parse(input);
    const preview = await previewRestore(workspace, data.checkpointId);
    if (preview.snapshot !== data.snapshot) throw new Error('Source or Git staging changed. Refresh the restore preview.');
    if (preview.blockedReason) throw new Error(preview.blockedReason);
    await beforeSwitch();
    const current = await inspectSource(workspace);
    if (current.snapshot !== data.snapshot) throw new Error('Source changed while stopping terminals. Refresh the restore preview.');
    await targetSafety(current.root, preview.checkpoint, current);
    const state = readState(workspace), safetyCheckpoint = await createCheckpointInternal(workspace, state, { title: `Before restoring ${preview.checkpoint.title}`.slice(0, 200), kind: 'safety' }, current);
    if ((await inspectSource(workspace)).snapshot !== current.snapshot) throw new Error('Source changed while saving the safety checkpoint. Refresh the restore preview.');
    // Stash is an additional recovery record: it preserves the original HEAD,
    // staging split and untracked paths while switch protects ignored files.
    const previousStash = await optionalGit(current.root, ['rev-parse', '--verify', 'refs/stash']);
    let recoveryStashHash = null;
    let anchoredUnborn = false;
    const retainRecovery = async () => {
      const candidate = await optionalGit(current.root, ['rev-parse', '--verify', 'refs/stash']);
      if (!candidate || candidate === previousStash) return null;
      // Keep the object id in memory before any follow-up disk writes, so an
      // out-of-space error while recording it cannot bypass source recovery.
      recoveryStashHash = candidate;
      await git(current.root, ['update-ref', `refs/isp/recovery/${safetyCheckpoint.id}`, candidate]);
      const stored = state.checkpoints.find(checkpoint => checkpoint.id === safetyCheckpoint.id);
      stored.recoveryStashHash = candidate; safetyCheckpoint.recoveryStashHash = candidate;
      writeState(workspace, state);
      return candidate;
    };
    try {
      if (!current.headHash) {
        // A new workspace has no commit to stash against. The safety record
        // already retains both its working tree and original staging tree.
        // Anchor detached HEAD and index to that working snapshot, making the
        // upcoming switch clean without creating the user's unborn branch.
        await git(current.root, ['update-ref', '--no-deref', 'HEAD', safetyCheckpoint.hash]);
        anchoredUnborn = true;
        await git(current.root, ['read-tree', safetyCheckpoint.treeHash]);
      }
      if (current.dirty && !anchoredUnborn) {
        await git(current.root, ['stash', 'push', '--include-untracked', '-m', `ISP safety ${safetyCheckpoint.id}`, '--', ...sourcePaths]);
        recoveryStashHash = await retainRecovery();
        if (!recoveryStashHash) throw new Error('Could not preserve dirty source before restore.');
      }
      await git(current.root, ['switch', '--no-guess', '--no-overwrite-ignore', '--detach', preview.checkpoint.hash]);
    } catch (error) {
      // Git may publish its stash ref before failing to clean an open file.
      // Discover and pin that record even when `stash push` itself rejected.
      if (!recoveryStashHash) {
        try { recoveryStashHash = await retainRecovery(); }
        catch (recordError) { if (!recoveryStashHash) throw new Error(`${error.message}\nCould not record recovery state: ${recordError.message}`); }
      }
      if (recoveryStashHash) {
        try { await git(current.root, ['stash', 'apply', '--index', recoveryStashHash]); }
        catch (recoveryError) { throw new Error(`${error.message}\nRecovery is saved in checkpoint ${safetyCheckpoint.id} and ${recoveryStashHash}; automatic restoration failed: ${recoveryError.message}`); }
      }
      if (anchoredUnborn) {
        await git(current.root, ['read-tree', current.indexTreeHash]);
        if (current.branch) await git(current.root, ['symbolic-ref', 'HEAD', `refs/heads/${current.branch}`]);
      }
      throw error;
    }
    const restored = await inspectSource(workspace);
    return { checkpoint: preview.checkpoint, safetyCheckpoint, current: { ...restored, checkpointId: preview.checkpoint.id } };
  });
}
