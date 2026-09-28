import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn, execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('workspace source layout and tracking API preserve work while comparing and restoring checkpoints', {timeout:120000}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'isp-tracking-api-'));
  const workspace = path.join(temp, '작업'); fs.mkdirSync(workspace);
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs'], {cwd:root, windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env, PORT:String(port), ISP_WORKSPACE:workspace, ISP_STATE_HOME:path.join(temp,'state')}});
  const exited = once(child, 'exit'); let output = '', headers;
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const call = async (endpoint, body, method = body === undefined ? 'GET' : 'POST', expected = 200) => {
    const response = await fetch(url + '/api' + endpoint, {method, headers, body:body === undefined ? undefined : JSON.stringify(body)});
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  };
  try {
    for (let tries = 0; !output.includes('ISP Block Maker →'); tries++) {
      if (child.exitCode !== null || tries > 200) throw new Error('Server failed: ' + output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const unauthorized = await fetch(url + '/api/attempts', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
    assert.equal(unauthorized.status, 401);
    let boot = await call('/bootstrap'); headers = {Authorization:'Bearer ' + boot.token, 'Content-Type':'application/json'};
    const info = await call('/workspace-info');
    assert.equal(info.sourceRoot, path.join(fs.realpathSync(workspace), 'project'));
    assert.equal(info.graphFile, path.join(info.sourceRoot, 'graph.json'));
    assert.ok(fs.existsSync(path.join(info.sourceRoot, '.git')));
    assert.equal(fs.existsSync(path.join(workspace, '.git')), false);
    assert.equal(fs.existsSync(path.join(workspace, 'graph.json')), false);
    const cli = await promisify(execFile)(process.execPath, [path.join(root,'scripts/isp.mjs'), 'workspace-info'], {cwd:info.sourceRoot, windowsHide:true, env:{...process.env, ISP_API_URL:url, ISP_API_TOKEN:boot.token}});
    assert.equal(JSON.parse(cli.stdout).sourceRoot, info.sourceRoot);
    fs.writeFileSync(path.join(info.sourceRoot, 'filter.py'), 'def process(x):\n    return x\n');
    const project = await call('/blocks/input', {revision:boot.state.revision, patch:{implementation:'filter.py', implementationSymbol:'process'}}, 'PATCH');
    const source = await call('/blocks/input/source'); assert.match(source.content, /return x/);
    const context = await call('/context'); assert.equal(context.paths.sourceRoot, info.sourceRoot);
    await call('/global/jobs', {revision:project.revision, title:'Improve filter', description:'Compare two implementations'}, 'POST', 201);
    const queued = await call('/project'); const job = queued.globalWork.jobs[0];
    const attempt = await call('/attempts', {title:'Filter experiment', approach:'Compare identity to doubled signal', jobRefs:[{blockId:null,jobId:job.id}], blockIds:['input'], inputConditions:'Small synthetic signal'}, 'POST', 201);
    assert.ok(attempt.baselineCheckpointId);
    fs.writeFileSync(path.join(info.sourceRoot, 'filter.py'), 'def process(x):\n    return x * 2\n');
    const artifact = await call('/artifacts', {title:'Comparison',blockId:'input',kind:'html',revision:queued.revision,runId:attempt.id,content:Buffer.from('<p>identity vs double</p>').toString('base64')}, 'POST', 201);
    const completed = await call('/attempts/' + attempt.id, {status:'completed',summary:'Doubled output verified',validation:['process(2) = 4'],artifactIds:[artifact.id]}, 'PATCH');
    assert.ok(completed.resultCheckpointId);
    const comparison = await call(`/checkpoints/compare?from=${attempt.baselineCheckpointId}&to=${completed.resultCheckpointId}`);
    assert.ok(comparison.files.includes('filter.py')); assert.match(comparison.patch, /return x \* 2/);
    await call('/attempts/' + attempt.id + '/accept', {});
    const tracking = await call('/tracking'); assert.equal(tracking.acceptedAttemptId, attempt.id);
    assert.equal(tracking.current.checkpointId, completed.resultCheckpointId);
    fs.writeFileSync(path.join(info.sourceRoot, 'filter.py'), 'def process(x):\n    return x * 3\n');
    fs.writeFileSync(path.join(info.sourceRoot, 'draft.py'), '# keep this uncommitted file\n');
    const preview = await call('/checkpoints/' + attempt.baselineCheckpointId + '/preview');
    await call('/checkpoints/' + attempt.baselineCheckpointId + '/restore', {snapshot:'stale',stopTerminals:true}, 'POST', 400);
    const restored = await call('/checkpoints/' + attempt.baselineCheckpointId + '/restore', {snapshot:preview.snapshot,stopTerminals:true});
    assert.ok(restored.safetyCheckpoint);
    assert.equal(fs.readFileSync(path.join(info.sourceRoot, 'filter.py'),'utf8').replaceAll('\r\n','\n'), 'def process(x):\n    return x\n');
    boot = await call('/bootstrap'); headers.Authorization = 'Bearer ' + boot.token;
    const after = await call('/project'); assert.equal(after.globalWork.jobs[0].id, job.id); assert.equal(after.artifacts[0].id, artifact.id);
    const trackedAfter = await call('/tracking'); assert.equal(trackedAfter.acceptedAttemptId, attempt.id);
    assert.equal(trackedAfter.current.checkpointId, attempt.baselineCheckpointId);
    const safetyPreview = await call('/checkpoints/' + restored.safetyCheckpoint.id + '/preview');
    await call('/checkpoints/' + restored.safetyCheckpoint.id + '/restore', {snapshot:safetyPreview.snapshot,stopTerminals:true});
    assert.match(fs.readFileSync(path.join(info.sourceRoot, 'filter.py'),'utf8'), /return x \* 3/);
    assert.match(fs.readFileSync(path.join(info.sourceRoot, 'draft.py'),'utf8'), /keep this/);
  } finally {
    if (child.exitCode === null) child.kill(); await exited;
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, {recursive:true, force:true});
  }
});
