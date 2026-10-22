import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Worker} from 'node:worker_threads';

test('FTS updates only changed documents, removes deleted entries and rebuilds cleanly after restart',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-fts-'));let worker,seq=0;
 t.after(async()=>{await worker?.terminate();fs.rmSync(root,{recursive:true,force:true,maxRetries:10});});
 const start=()=>new Worker(new URL('../server/search-worker.mjs',import.meta.url),{workerData:{file:path.join(root,'index.sqlite')}});
 const call=(action,payload)=>new Promise((resolve,reject)=>{const id=++seq;const message=value=>{if(value.id!==id)return;worker.off('message',message);worker.off('error',reject);value.error?reject(Error(value.error)):resolve(value.result);};worker.on('message',message);worker.once('error',reject);worker.postMessage({id,action,payload});});
 worker=start();let docs=[{id:'a',title:'Alpha',text:'First evidence',hash:'1',type:'document'},{id:'b',title:'Beta',text:'Second evidence',hash:'2',type:'document'}];
 assert.equal((await call('index',{documents:docs})).indexed,2);
 const unchanged=await call('index',{documents:docs});assert.equal(unchanged.indexed,0);assert.equal(unchanged.generation,1);
 docs=[docs[0],{...docs[1],text:'Changed marker',hash:'3'}];assert.equal((await call('index',{documents:docs})).indexed,1);
 assert.equal((await call('search',{query:'Changed',allowedIds:['a','b']})).total,1);
 const deleted=await call('index',{documents:[docs[0]]});assert.equal(deleted.indexed,0);assert.equal(deleted.removed,1);
 assert.equal((await call('search',{query:'Changed',allowedIds:['a','b']})).total,0);
 await worker.terminate();worker=start();await call('index',{documents:[docs[1]]});
 assert.equal((await call('search',{query:'First',allowedIds:['a','b']})).total,0);
 assert.equal((await call('search',{query:'Changed',allowedIds:['a','b']})).total,1);
});
