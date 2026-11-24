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
