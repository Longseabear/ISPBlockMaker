import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import {promisify} from "node:util";
import {packBundle,unpackBundle} from "../server/bundles.mjs";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function startServer(t, temp, name) {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const workspace = path.join(temp, name);
  fs.mkdirSync(workspace);
  const child = spawn(process.execPath, [path.join(root, "server/index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ISP_WORKSPACE: workspace,
      ISP_STATE_HOME: path.join(temp, "state"),
      ISP_NO_DISCOVERY: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Server did not start: ${diagnostics}`)), 15000);
    const onData = chunk => {
      diagnostics += chunk;
      if (diagnostics.includes(`http://127.0.0.1:${port}`)) finish();
    };
    const onExit = code => finish(new Error(`Server exited (${code}): ${diagnostics}`));
    const onError = error => finish(error);
    function finish(error) {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      error ? reject(error) : resolve();
    }
    child.stdout.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
  return { origin: `http://127.0.0.1:${port}`, port };
}


test('agent tools CLI checks graph, plans/runs recipes, builds and registers reports and shares recipe definitions', async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'isp-agent-tools-'));
 t.after(()=>{assert.equal(path.dirname(home),path.resolve(os.tmpdir()));fs.rmSync(home,{recursive:true,force:true});});
 const {origin}=await startServer(t,home,'workspace');
 const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json()),workspace=boot.workspace;
 const headers={Authorization:'Bearer '+boot.token,'Content-Type':'application/json'};
 const info=await fetch(origin+'/api/workspace-info',{headers}).then(r=>r.json());
 const command=async (...args)=>JSON.parse((await promisify(execFile)(process.execPath,[path.join(root,'scripts/isp.mjs'),...args],{cwd:workspace,windowsHide:true,timeout:20000,env:{...process.env,ISP_API_URL:origin,ISP_API_TOKEN:boot.token}})).stdout);
 const json=(name,value)=>{const file=path.join(workspace,'tmp',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));return file;};
 assert.equal((await fetch(origin+'/api/graph-check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 const before=JSON.stringify(await fetch(origin+'/api/project',{headers}).then(r=>r.json()));
 const apiCheck=await fetch(origin+'/api/graph-check',{method:'POST',headers,body:'{}'});assert.equal(apiCheck.status,200);assert.equal((await apiCheck.json()).stale,false);
 const checked=await command('graph-check');assert.ok(Array.isArray(checked.findings));assert.ok(Array.isArray(checked.limitations));assert.equal(checked.stale,false);
 assert.equal(JSON.stringify(await fetch(origin+'/api/project',{headers}).then(r=>r.json())),before);
 fs.writeFileSync(path.join(info.sourceRoot,'fixture.mjs'),"import fs from 'node:fs';fs.writeFileSync(process.argv[2],JSON.stringify({measurement:process.argv[3]}));console.log('fixture completed');");
 const save=await command('recipe-save',json('recipe.json',{expectedHash:null,recipe:{version:1,id:'fixture-run',title:'Fixture execution',executable:process.execPath,args:['fixture.mjs','{{runDir}}/result.json','{{value}}'],cwd:'.',blockIds:[boot.state.blocks[0].id],parameters:{value:{required:true}},expectedOutputs:[{path:'{{runDir}}/result.json',required:true}],timeoutMs:5000}}));
 assert.match(save.hash,/^[a-f0-9]{64}$/);assert.ok(await command('recipes'));assert.equal((await command('recipe-show','fixture-run')).hash,save.hash);
 const params=json('parameters.json',{value:'a value with spaces; not shell code'});
 const plan=await command('recipe-plan','fixture-run','--params',params,'--hash',save.hash);assert.equal(fs.existsSync(plan.runDir),false);
 const run=await command('recipe-run','fixture-run','--params',params,'--hash',save.hash);assert.equal(run.exitCode,0);assert.ok(JSON.stringify(run).includes('result.json'));
 const spec={title:'Fixture measurement report',findings:['An illustrative execution fixture, not an ISP quality claim.'],sections:[{type:'table',title:'Conditions',columns:['Input','Value'],rows:[['value','a value with spaces; not shell code']]},{type:'line',title:'Supplied profile',xAxis:{label:'Position',unit:'px',scale:'linear',min:0,max:2},yAxis:{label:'Sample',unit:'DN',scale:'linear',min:0,max:10},series:[{label:'Fixture',points:[[0,2],[1,4],[2,3]]}]}],limitations:['Synthetic test only']};
 const report=await command('report-build',json('report.json',spec),'--out','artifacts/generated/fixture.html');assert.ok(fs.existsSync(report.path));assert.ok(report.bytes>100);assert.ok(fs.readFileSync(report.path,'utf8').includes('Fixture measurement report'));
 const current=await fetch(origin+'/api/project',{headers}).then(r=>r.json());const artifact=await command('artifact',report.path,'--block',current.blocks[0].id,'--revision',String(current.revision),'--title','Agent tool fixture');assert.ok(JSON.stringify(artifact).includes('Agent tool fixture'));
 fs.writeFileSync(report.path,'<!doctype html><h1>Corrected report</h1>');
 assert.equal((await fetch(origin+'/api/artifacts/'+artifact.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 const updated=await command('artifact-update',artifact.id,report.path,'--expected-file',artifact.file);
 assert.equal(updated.id,artifact.id);assert.equal(updated.title,artifact.title);assert.equal(updated.revision,artifact.revision);assert.notEqual(updated.file,artifact.file);
 assert.match(await fetch(origin+'/artifacts/'+updated.file,{headers}).then(r=>r.text()),/Corrected report/);
 assert.equal((await fetch(origin+'/artifacts/'+artifact.file,{headers})).status,404);
 await assert.rejects(command('artifact-update',artifact.id,report.path,'--expected-file',artifact.file),/변경/);
 assert.equal((await fetch(origin+'/api/project',{headers}).then(r=>r.json())).artifacts.length,1);
 const archive=path.join(home,'project.bundle');await packBundle(workspace,archive,{includeImages:false,includeViewer:false,includeData:false,includeVisualizations:false});const restored=path.join(home,'restored');await unpackBundle(archive,restored);assert.ok(fs.existsSync(path.join(restored,'project/.isp-recipes/fixture-run.json')));assert.equal(fs.existsSync(path.join(restored,'tmp/recipe-runs')),false);
});
