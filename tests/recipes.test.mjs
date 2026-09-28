import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {listRecipes, readRecipe, saveRecipe, planRecipeRun, runRecipe} from '../server/recipes.mjs';

function fixture({legacy = false} = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'isp-recipe-test-'));
  const workspace = path.join(temporary, 'workspace with 공백');
  const source = legacy ? workspace : path.join(workspace, 'project');
  fs.mkdirSync(source, {recursive: true});
  fs.mkdirSync(path.join(workspace, '.isp'));
  if (!legacy) fs.writeFileSync(path.join(workspace, '.isp/workspace.json'), JSON.stringify({version: 1, sourceRoot: 'project'}));
  fs.writeFileSync(path.join(source, 'graph.json'), '{"blocks":[]}');
  return {temporary, workspace, source, cleanup() {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.match(path.basename(temporary), /^isp-recipe-test-/);
    fs.rmSync(temporary, {recursive: true, force: true});
  }};
}
function recipe(overrides = {}) {
  return {version: 1, id: 'run-model', title: 'Run native model', description: 'Optional local command', executable: process.execPath, args: ['-e', 'console.log("executed")'], cwd: '.', parameters: {}, expectedOutputs: [], ...overrides};
}
const create = (workspace, input) => saveRecipe(workspace, input, {expectedHash: null});

test('Recipes are source files; save and preview never execute or create local run state', async () => {
  for (const legacy of [false, true]) {
    const f = fixture({legacy});
    try {
      const sentinel = path.join(f.workspace, 'executed.txt');
      const spec = recipe({blockIds: ['flat-field', 'variance', 'threshold'], args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "ran")', sentinel]});
      assert.deepEqual(listRecipes(f.workspace), []);
      const saved = create(f.workspace, spec);
      assert.equal(saved.path, path.join(f.source, '.isp-recipes/run-model.json'));
      assert.deepEqual(saved.recipe.blockIds, spec.blockIds);
      assert.equal(saved.recipe.timeoutMs, 60000);
      assert.equal(fs.existsSync(sentinel), false);
      const plan = planRecipeRun(f.workspace, spec.id, {expectedHash: saved.hash});
      assert.equal(plan.sourceRoot, f.source);
      assert.equal(plan.cwd, f.source);
      assert.equal(plan.shell, false);
      assert.equal(fs.existsSync(plan.runDir), false);
      assert.equal(fs.existsSync(path.join(f.workspace, 'tmp')), false);
      assert.equal(fs.existsSync(sentinel), false);
      const second = create(f.workspace, recipe({id: 'shared-block', blockIds: ['variance', 'threshold']}));
      assert.deepEqual(second.recipe.blockIds, ['variance', 'threshold']);
      assert.equal(listRecipes(f.workspace).length, 2);
      const result = await runRecipe(f.workspace, spec.id, {expectedHash: saved.hash});
      assert.equal(result.status, 'succeeded');
      assert.equal(result.exitCode, 0);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'ran');
      assert.deepEqual(result.blockIds, spec.blockIds);
      assert.match(result.sourceIdentity.graphSha256, /^[a-f0-9]{64}$/);
      assert.equal(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')).status, 'succeeded');
    } finally { f.cleanup(); }
  }
});

test('Optimistic hashes protect edits and reviewed runs against replacement', async () => {
  const f = fixture();
  try {
    assert.throws(() => saveRecipe(f.workspace, recipe()), /expectedHash/);
    const saved = create(f.workspace, recipe());
    assert.throws(() => create(f.workspace, recipe()), /changed/);
    const updated = saveRecipe(f.workspace, {...saved.recipe, title: 'Edited'}, {expectedHash: saved.hash});
    assert.notEqual(updated.hash, saved.hash);
    assert.equal(readRecipe(f.workspace, 'run-model').hash, updated.hash);
    assert.throws(() => saveRecipe(f.workspace, saved.recipe, {expectedHash: saved.hash}), /changed/);
    assert.throws(() => planRecipeRun(f.workspace, 'run-model', {expectedHash: saved.hash}), /changed/);
    await assert.rejects(runRecipe(f.workspace, 'run-model', {expectedHash: saved.hash}), /changed/);
    assert.equal(fs.existsSync(path.join(f.workspace, 'tmp')), false);
  } finally { f.cleanup(); }
});

test('Substitution preserves literal argv, uses defaults, and gives each execution its own outputs', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.source, 'args.mjs'), 'import fs from "node:fs"; fs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3))); console.log("complete");');
    const unusual = '공백 "quoted" & ; $HOME $(echo unsafe) %PATH% {{sourceRoot}}';
    create(f.workspace, recipe({args: ['{{sourceRoot}}/args.mjs', '{{runDir}}/result.json', '{{input}}', '{{mode}}', '{{workspace}}'], parameters: {input: {required: true}, mode: {default: 'repeat'}}, expectedOutputs: ['{{runDir}}/result.json']}));
    const result = await runRecipe(f.workspace, 'run-model', {parameters: {input: unusual}});
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(JSON.parse(fs.readFileSync(result.outputs[0].absolutePath, 'utf8')), [unusual, 'repeat', f.workspace]);
    assert.equal(result.outputs[0].generated, true);
    assert.equal(result.outputs[0].existedBefore, false);
    assert.match(result.stdout.tail, /complete/);
    const repeated = await runRecipe(f.workspace, 'run-model', {parameters: {input: unusual}});
    assert.equal(repeated.status, 'succeeded');
    assert.notEqual(repeated.runDir, result.runDir);
    assert.equal(repeated.outputs[0].sha256, result.outputs[0].sha256);
  } finally { f.cleanup(); }
});

test('Unknown placeholders, missing or reserved parameters, and unsupported execution fields fail closed', () => {
  const f = fixture();
  try {
    for (const placeholder of ['{{missing}}', '{{ spaced }}', '{{input', 'input}}']) assert.throws(() => create(f.workspace, recipe({args: [placeholder]})), /placeholder/);
    for (const name of ['__proto__', 'constructor', 'prototype', 'workspace', 'sourceRoot', 'runDir']) {
      const parameters = JSON.parse(`{"${name}":{"default":"ignored"}}`);
      assert.throws(() => create(f.workspace, recipe({parameters})), /reserved/);
    }
    assert.throws(() => create(f.workspace, recipe({env: {SECRET: 'x'}})), /Unsupported/);
    assert.throws(() => create(f.workspace, recipe({shell: true})), /Unsupported/);
    assert.throws(() => create(f.workspace, recipe({id: 'con'})), /Invalid recipe id/);
    create(f.workspace, recipe({parameters: {input: {required: true}, optional: {}}, args: ['{{input}}']}));
    assert.throws(() => planRecipeRun(f.workspace, 'run-model'), /Missing required/);
    assert.throws(() => planRecipeRun(f.workspace, 'run-model', {parameters: {unknown: 'x'}}), /Unknown parameter/);
    assert.throws(() => planRecipeRun(f.workspace, 'run-model', {parameters: JSON.parse('{"constructor":"x"}')}), /reserved/);
    assert.throws(() => planRecipeRun(f.workspace, 'run-model', {parameters: {input: 123}}), /parameter value/);
    assert.throws(() => planRecipeRun(f.workspace, 'run-model', {parameters: {input: 'x'}, env: {}}), /Unsupported/);
  } finally { f.cleanup(); }
});

test('Paths reject traversal, absolute output/cwd names, state directories and Windows aliases', () => {
  const f = fixture();
  try {
    for (const file of ['../outside', '/outside', 'C:\\outside', 'C:outside', '\\\\server\\share', 'tmp/../outside', '.isp/private', '.git/config', 'tmp/name:stream', 'tmp/con', 'tmp/trailing.', 'tmp/trailing ']) {
      assert.throws(() => create(f.workspace, recipe({expectedOutputs: [file]})), /path|Unsafe|state/);
      assert.throws(() => create(f.workspace, recipe({cwd: file})), /path|Unsafe|state/);
    }
    create(f.workspace, recipe({parameters: {location: {required: true}}, expectedOutputs: ['{{location}}']}));
    assert.throws(() => planRecipeRun(f.workspace, 'run-model', {parameters: {location: '../outside'}}), /Unsafe/);
    assert.throws(() => planRecipeRun(f.workspace, 'run-model', {parameters: {location: path.join(f.temporary, 'private')}}), /Unsafe/);
    const current = readRecipe(f.workspace, 'run-model');
    saveRecipe(f.workspace, recipe({expectedOutputs: ['{{runDir}}/manifest.json']}), {expectedHash: current.hash});
    assert.throws(() => planRecipeRun(f.workspace, 'run-model'), /metadata/);
  } finally { f.cleanup(); }
});

test('Symlink and junction recipe, cwd, run-directory and output escapes are refused', async () => {
  const f = fixture();
  try {
    const outside = path.join(f.temporary, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
    const link = path.join(f.workspace, 'linked'); fs.symlinkSync(outside, link, 'junction');
    create(f.workspace, recipe({expectedOutputs: ['linked/private.txt']}));
    assert.throws(() => planRecipeRun(f.workspace, 'run-model'), /Linked/);
    let current = readRecipe(f.workspace, 'run-model');
    const cwdLink = path.join(f.source, 'linked'); fs.symlinkSync(outside, cwdLink, 'junction');
    saveRecipe(f.workspace, recipe({cwd: 'linked'}), {expectedHash: current.hash});
    assert.throws(() => planRecipeRun(f.workspace, 'run-model'), /Linked/);
    current = readRecipe(f.workspace, 'run-model');
    saveRecipe(f.workspace, recipe(), {expectedHash: current.hash});
    fs.symlinkSync(outside, path.join(f.workspace, 'tmp'), 'junction');
    await assert.rejects(runRecipe(f.workspace, 'run-model'), /Linked/);
    fs.unlinkSync(path.join(f.workspace, 'tmp'));
    const recipes = path.join(f.source, '.isp-recipes');
    fs.renameSync(recipes, path.join(f.source, 'old-recipes'));
    fs.symlinkSync(outside, recipes, 'junction');
    assert.throws(() => listRecipes(f.workspace), /Linked/);
    assert.throws(() => create(f.workspace, recipe({id: 'other'})), /Linked/);
    assert.equal(fs.readFileSync(path.join(outside, 'private.txt'), 'utf8'), 'private');
    fs.unlinkSync(recipes); fs.unlinkSync(cwdLink); fs.unlinkSync(link);
  } finally { f.cleanup(); }
});

test('Nonzero exit, missing outputs and stale existing outputs produce failed manifests', async () => {
  const f = fixture();
  try {
    create(f.workspace, recipe({args: ['-e', 'console.error("failure");process.exit(7)']}));
    let result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'failed'); assert.equal(result.exitCode, 7); assert.match(result.stderr.tail, /failure/);
    let current = readRecipe(f.workspace, 'run-model');
    saveRecipe(f.workspace, recipe({expectedOutputs: ['{{runDir}}/absent.raw']}), {expectedHash: current.hash});
    result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'failed'); assert.equal(result.exitCode, 0); assert.equal(result.outputs[0].exists, false);
    fs.writeFileSync(path.join(f.workspace, 'existing.raw'), 'old');
    current = readRecipe(f.workspace, 'run-model');
    saveRecipe(f.workspace, recipe({expectedOutputs: ['existing.raw']}), {expectedHash: current.hash});
    result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'failed'); assert.equal(result.outputs[0].existedBefore, true); assert.equal(result.outputs[0].generated, false);
    current = readRecipe(f.workspace, 'run-model');
    saveRecipe(f.workspace, recipe({args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "new")', '{{workspace}}/existing.raw'], expectedOutputs: ['existing.raw']}), {expectedHash: current.hash});
    result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'succeeded'); assert.equal(result.outputs[0].generated, true);
    assert.notEqual(result.outputs[0].sha256, result.outputs[0].previousSha256);
  } finally { f.cleanup(); }
});

test('Output files linked by a running command cannot be read as trusted results', async () => {
  const f = fixture();
  try {
    const outside = path.join(f.temporary, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'private.raw'), 'private');
    create(f.workspace, recipe({args: ['-e', 'require("node:fs").symlinkSync(process.argv[1],process.argv[2],"junction")', outside, '{{runDir}}/linked'], expectedOutputs: ['{{runDir}}/linked/private.raw']}));
    const result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'failed'); assert.equal(result.outputs[0].valid, false); assert.match(result.outputs[0].error, /Linked/);
    assert.equal(result.outputs[0].sha256, undefined);
    fs.unlinkSync(path.join(result.runDir, 'linked'));
  } finally { f.cleanup(); }
});

test('Log capture drains large streams while persisted UTF-8 tails stay within 64 KiB', async () => {
  const f = fixture();
  try {
    create(f.workspace, recipe({args: ['-e', 'process.stdout.write(Buffer.alloc(400000,120));process.stdout.write("공백 끝");process.stderr.write(Buffer.alloc(400000,255));process.stderr.write("THE-END");']}));
    const result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'succeeded');
    for (const record of [result.stdout, result.stderr]) {
      assert.equal(record.truncated, true); assert.ok(record.bytes >= 400000);
      assert.ok(record.capturedBytes <= 65536); assert.ok(fs.statSync(record.path).size <= 65536);
      assert.equal(fs.readFileSync(record.path, 'utf8'), record.tail);
    }
    assert.match(result.stdout.tail, /공백 끝$/); assert.match(result.stderr.tail, /THE-END$/);
    assert.equal(ownField(result, 'env'), false);
  } finally { f.cleanup(); }
});
const ownField = (value, key) => Object.hasOwn(value, key);

test('Missing executables fail with an audit record and .cmd requires an explicit interpreter', async () => {
  const f = fixture();
  try {
    create(f.workspace, recipe({executable: path.join(f.source, 'missing-executable')}));
    const result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'failed'); assert.match(result.spawnError, /ENOENT/); assert.equal(result.exitCode, null);
    const current = readRecipe(f.workspace, 'run-model');
    saveRecipe(f.workspace, recipe({executable: 'npm.cmd'}), {expectedHash: current.hash});
    assert.throws(() => planRecipeRun(f.workspace, 'run-model'), /explicitly choose cmd.exe/);
  } finally { f.cleanup(); }
});

test('Timeout stops the process tree before returning and keeps a timed-out manifest', {timeout: 20000}, async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.source, 'tree.mjs'), 'import {spawn} from "node:child_process"; import fs from "node:fs"; const child=spawn(process.execPath,["-e", "setTimeout(()=>require(\\"node:fs\\").writeFileSync(process.argv[1],\\"escaped\\"),2500);setInterval(()=>{},1000)",process.argv[2]],{stdio:"inherit"});fs.writeFileSync(process.argv[3],String(child.pid));setInterval(()=>{},1000);');
    create(f.workspace, recipe({args: ['{{sourceRoot}}/tree.mjs', '{{workspace}}/escaped.txt', '{{runDir}}/child.pid'], timeoutMs: 800}));
    const result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'timed_out'); assert.equal(result.timedOut, true); assert.equal(result.cleanupError, null);
    assert.equal(result.spawnError, null); assert.ok(result.durationMs < 15000);
    const childPid = Number(fs.readFileSync(path.join(result.runDir, 'child.pid'), 'utf8'));
    if (process.platform === 'win32') {
      const list = execFileSync(path.join(process.env.SystemRoot, 'System32/tasklist.exe'), ['/FI', `PID eq ${childPid}`, '/FO', 'CSV', '/NH'], {encoding: 'utf8', windowsHide: true});
      assert.equal(list.includes(`"${childPid}"`), false);
    } else {
      assert.throws(() => process.kill(childPid, 0), /ESRCH/);
    }
    assert.equal(fs.existsSync(path.join(f.workspace, 'escaped.txt')), false);
    assert.equal(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')).timedOut, true);
  } finally { f.cleanup(); }
});

test('Source identity records tracked changes made during a command', async () => {
  const f = fixture();
  try {
    const git = args => execFileSync('git', args, {cwd: f.source, windowsHide: true, stdio: 'pipe'});
    git(['init']); git(['add', 'graph.json']); git(['-c', 'user.name=Recipe Test', '-c', 'user.email=recipe@example.invalid', 'commit', '-m', 'fixture']);
    create(f.workspace, recipe({args: ['-e', 'require("node:fs").writeFileSync("graph.json", "{\\"blocks\\":[1]}")']}));
    const result = await runRecipe(f.workspace, 'run-model');
    assert.equal(result.status, 'succeeded'); assert.equal(result.sourceChanged, true);
    assert.match(result.sourceIdentity.gitHead, /^[a-f0-9]{40,64}$/);
    assert.equal(result.sourceIdentity.gitDirty, false); assert.equal(result.sourceIdentityAfter.gitDirty, true);
    assert.notEqual(result.sourceIdentity.graphSha256, result.sourceIdentityAfter.graphSha256);
  } finally { f.cleanup(); }
});
