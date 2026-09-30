import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.mjs';
import {updateArtifact} from '../server/artifact-update.mjs';

test('artifact update preserves identity/provenance, replaces bytes and rejects stale/deleted targets',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-artifact-update-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createStore(dir),original={id:'report',file:'original.html',kind:'html',title:'Before',revision:1,blockId:'input',runId:'attempt',createdAt:'2026-01-01',metadata:{metric:123}};
 store.artifact(original);fs.writeFileSync(path.join(dir,original.file),'before');
 const body={expectedFile:original.file,kind:'html',content:Buffer.from('<h1>After</h1>').toString('base64'),title:'After'};
 const result=updateArtifact(store,dir,'report',body);
 for(const key of ['id','revision','blockId','runId','createdAt','metadata'])assert.deepEqual(result[key],original[key]);
 assert.equal(result.title,'After');assert.ok(result.updatedAt);assert.notEqual(result.file,original.file);assert.equal(fs.readFileSync(path.join(dir,result.file),'utf8'),'<h1>After</h1>');assert.equal(store.get().artifacts.length,1);assert.equal(fs.existsSync(path.join(dir,original.file)),false);
 const files=fs.readdirSync(dir);assert.throws(()=>updateArtifact(store,dir,'report',body),e=>e.status===409);assert.deepEqual(fs.readdirSync(dir),files);
 assert.throws(()=>updateArtifact(store,dir,'report',{...body,expectedFile:result.file,kind:'png'}),/형식/);
 assert.throws(()=>updateArtifact(store,dir,'report',{...body,expectedFile:result.file,content:''}));
 const again=updateArtifact(store,dir,'report',{expectedFile:result.file,kind:'html',content:body.content});assert.equal(again.title,'After');
 store.removeArtifacts(['report']);assert.throws(()=>updateArtifact(store,dir,'report',{...body,expectedFile:again.file}),e=>e.status===404);
});
