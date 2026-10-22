import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {requireLayoutConsent} from '../server/project-layout.mjs';
const run=promisify(execFile);
test('normal opens refuse relocation without writes; explicit CLI preview and migration preserve source',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'isp-layout-consent-'));
 const cli=path.resolve('scripts/workspace-cli.mjs');
 try{
  fs.writeFileSync(path.join(folder,'keep.py'),'print(42)');
  assert.throws(()=>requireLayoutConsent(folder),/자동 이동하지 않았습니다/);
  await assert.rejects(run(process.execPath,[cli,folder]),/자동 이동하지 않았습니다/);
  await assert.rejects(run(process.execPath,[cli,'serve',folder]),/자동 이동하지 않았습니다/);
  assert.deepEqual(fs.readdirSync(folder),['keep.py']);
  const preview=await run(process.execPath,[cli,'init',folder,'--dry-run']);assert.equal(JSON.parse(preview.stdout).actions[0].name,'keep.py');
  assert.deepEqual(fs.readdirSync(folder),['keep.py']);
  await run(process.execPath,[cli,'init',folder,'--migrate-layout']);
  assert.equal(fs.readFileSync(path.join(folder,'project/keep.py'),'utf8'),'print(42)');
  assert.equal(requireLayoutConsent(folder).kind,'ready');
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('serve --hub starts the central server without initializing the current folder',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-hub-only-')),folder=path.join(temp,'untouched');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'keep.txt'),'keep');
 const child=spawn(process.execPath,[path.resolve('scripts/workspace-cli.mjs'),'serve','--hub'],{cwd:folder,env:{...process.env,ISP_STATE_HOME:path.join(temp,'state'),ISP_HUB_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let url;
 try{
  url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Hub startup timed out')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=/Central server: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Unexpected exit '+code));});});
  const health=await fetch(url+'/health').then(r=>r.json());assert.equal(health.app,'ISPBlockMakerHub');assert.deepEqual(fs.readdirSync(folder),['keep.txt']);
  const boot=await fetch(url+'/api/bootstrap').then(r=>r.json());const exited=once(child,'exit');
  await fetch(url+'/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+boot.token,'Content-Type':'application/json'},body:JSON.stringify({instance:health.instance})});await exited;
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}fs.rmSync(temp,{recursive:true,force:true});}
});
