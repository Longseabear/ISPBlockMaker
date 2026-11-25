import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('importing the bridge has no command side effects; timing metadata stays on stderr',async()=>{
 const url=new URL('../scripts/isp.mjs',import.meta.url).href;
 const imported=await promisify(execFile)(process.execPath,['--input-type=module','-e',`const bridge=await import(${JSON.stringify(url)});console.log(typeof bridge.main);`],{env:{...process.env,ISP_TIMING:'1'},windowsHide:true});
 assert.equal(imported.stdout.trim(),'function');assert.match(imported.stderr,/\[isp timing\].*uptimeMs/);
 const direct=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/isp.mjs',import.meta.url)),'help'],{env:{...process.env,ISP_TIMING:'1'},windowsHide:true});
 assert.ok(direct.stdout.includes('isp present'));assert.ok(!direct.stdout.includes('[isp timing]'));assert.match(direct.stderr,/\[isp timing\]/);
});

test('both version commands run offline without opening a workspace',async()=>{
 for(const script of ['isp.mjs','workspace-cli.mjs']){
  const result=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/'+script,import.meta.url)),'--version'],{windowsHide:true});
  assert.match(result.stdout.trim(),/^isp(?:-block-maker)? \d+\.\d+\.\d+$/);assert.equal(result.stderr,'');
 }
});


test('generated workspace version bridge works before a server publishes connection metadata',async t=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {openWorkspace}=await import('../server/workspaces.mjs');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'isp-version-'));
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:5}));
 openWorkspace(folder,fileURLToPath(new URL('..',import.meta.url)));
 const env={...process.env};delete env.ISP_API_TOKEN;delete env.ISP_API_URL;
 const result=await promisify(execFile)(process.execPath,[path.join(folder,'.isp/tools/isp.mjs'),'--version'],{cwd:folder,env,windowsHide:true});
 assert.match(result.stdout.trim(),/^isp \d+\.\d+\.\d+$/);
});
