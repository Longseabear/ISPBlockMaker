import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {installViewer} from '../server/viewer.mjs';

test('Crop long poll waits for explicit delivery, isolates requests, survives rereads and returns cancel/timeout',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-crop-wait-'));let workspace=temp;
 const app=express();app.use(express.json());app.use((req,res,next)=>req.headers.authorization==='Bearer test-token'?next():res.sendStatus(401));
 installViewer(app,{current:()=>({workspace,state:{blocks:[],revision:1}}),present:()=>1});app.use((error,req,res,next)=>res.status(400).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
 const headers={Authorization:'Bearer test-token','Content-Type':'application/json'};
 const post=async(route,body)=>{const r=await fetch(url+'/api/viewer'+route,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status<300,true,await r.clone().text());return r.json();};
 const get=async route=>(await fetch(url+'/api/viewer'+route,{headers})).json();
 try{
  fs.writeFileSync(path.join(temp,'image.png'),Buffer.alloc(64,128));
  const image=await post('/images/import',{path:path.join(temp,'image.png'),spec:{format:'rgba8',width:4,height:4}});
  fs.writeFileSync(path.join(temp,'input.raw'),Buffer.alloc(32,255));
  const raw=await post('/images/import',{path:path.join(temp,'input.raw'),spec:{format:'raw',width:4,height:4,pattern:'GRBG',bitDepth:12}});
  const originalRequest=await post('/requests',{imageId:raw.id,prompt:'Original interpretation'});
  const saved=await post(`/requests/${originalRequest.id}/crops`,{id:crypto.randomUUID(),roi:{x:0,y:0,width:2,height:2}});
  const pixels={pattern:'BGGR',bitDepth:10,group:2,alignment:'msb'};
  const changed=await post(`/images/${raw.id}/reinterpret`,pixels);
  assert.notEqual(changed.id,raw.id);assert.equal(changed.spec.pattern,'BGGR');assert.equal(changed.spec.bitDepth,10);assert.equal(changed.spec.group,2);
  assert.deepEqual(fs.readFileSync(path.join(temp,'.isp/viewer',changed.id+'.bin')),fs.readFileSync(path.join(temp,'.isp/viewer',raw.id+'.bin')));
  assert.equal((await post(`/images/${raw.id}/reinterpret`,pixels)).id,changed.id);
  const originalRead=await get(`/requests/${originalRequest.id}`);assert.equal(originalRead.imageId,raw.id);assert.deepEqual(originalRead.crops[0].output,saved.crops[0].output);
  assert.equal((await fetch(url+`/api/viewer/images/${raw.id}/reinterpret`,{method:'POST',headers,body:JSON.stringify({...pixels,bitDepth:17})})).status,400);
  assert.equal((await fetch(url+`/api/viewer/images/${image.id}/reinterpret`,{method:'POST',headers,body:JSON.stringify(pixels)})).status,400);
  const a=await post('/requests',{imageId:image.id,prompt:'Choose neutral patch',origin:'agent'});
  const b=await post('/requests',{imageId:image.id,prompt:'Other request'});
  assert.equal(a.origin,'agent');
  assert.equal((await fetch(url+`/api/viewer/requests/${a.id}/wait`)).status,401);
  assert.equal((await fetch(url+`/api/viewer/requests/${a.id}/wait?seconds=61`,{headers})).status,400);
  let resolved=false;const waiting=get(`/requests/${a.id}/wait?seconds=5`).then(v=>{resolved=true;return v;});
  const crops=await post(`/requests/${a.id}/crops`,{id:crypto.randomUUID(),rois:[{x:0,y:0,width:2,height:2},{x:2,y:2,width:2,height:2}],description:'two regions'});
  assert.equal((await get(`/requests/${a.id}/wait?seconds=0`)).status,'pending');assert.equal(resolved,false);
  const other=await post(`/requests/${b.id}/crops`,{id:crypto.randomUUID(),roi:{x:0,y:0,width:2,height:2}});
  await post('/crop-selection',{imageId:image.id,items:[{requestId:b.id,cropId:other.crops[0].id}]});
  assert.equal((await get(`/requests/${a.id}/wait?seconds=0`)).status,'pending');assert.equal(resolved,false);
  const sent=await post('/crop-selection',{imageId:image.id,items:[{requestId:a.id,cropId:crops.crops[0].id}]});
  const result=await waiting;assert.equal(result.status,'fulfilled');assert.equal(result.delivery.id,sent.id);assert.equal(result.delivery.inputs.length,2);assert.ok(fs.existsSync(result.delivery.inputs[0].path));
  await post('/crop-selection',{imageId:image.id,items:[{requestId:b.id,cropId:other.crops[0].id}]});
  assert.equal((await get(`/requests/${a.id}/wait?seconds=0`)).delivery.id,sent.id);
  const cli=await promisify(execFile)(process.execPath,['scripts/isp.mjs','viewer-wait',a.id,'--wait','0'],{env:{...process.env,ISP_API_URL:url,ISP_API_TOKEN:'test-token'},windowsHide:true});assert.equal(JSON.parse(cli.stdout).status,'fulfilled');
  const createCli=await promisify(execFile)(process.execPath,['scripts/isp.mjs','viewer-request',image.id,'--message','Select patch','--wait','0'],{env:{...process.env,ISP_API_URL:url,ISP_API_TOKEN:'test-token'},windowsHide:true});const pending=JSON.parse(createCli.stdout);assert.equal(pending.status,'pending');assert.ok(createCli.stderr.includes(pending.requestId));
  await post(`/requests/${pending.requestId}/crops`,{id:crypto.randomUUID(),roi:{x:0,y:0,width:2,height:2}});
  const cancelWait=get(`/requests/${pending.requestId}/wait?seconds=5`);await post(`/requests/${pending.requestId}/cancel`,{});assert.equal((await cancelWait).status,'cancelled');
  const c=await post('/requests',{imageId:image.id,prompt:'Switch workspace'});const switched=get(`/requests/${c.id}/wait?seconds=3`);await get(`/requests/${c.id}`);workspace=path.join(temp,'other');assert.equal((await switched).status,'workspace_changed');workspace=temp;
  fs.rmSync(result.delivery.inputs[0].path);assert.equal((await get(`/requests/${a.id}/wait?seconds=0`)).status,'unavailable');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(path.dirname(temp)!==path.resolve(os.tmpdir()))throw Error('Unsafe temp');fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});}
});

test('CLI default request keeps long polling across server timeouts and returns only the delivered reply',async()=>{
 const app=express();app.use(express.json());let requests=0,waits=0;const id=crypto.randomUUID();
 app.post('/api/viewer/requests',(req,res)=>{requests++;assert.equal(req.body.origin,'agent');res.json({id,status:'pending'});});
 app.get('/api/viewer/requests/:id/wait',(req,res)=>{assert.equal(req.params.id,id);assert.equal(Number(req.query.seconds),55);waits++;res.json(waits===1?{requestId:id,status:'pending',timedOut:true}:{requestId:id,status:'fulfilled',delivery:{id:'delivery',inputs:[{path:'crop.raw'}]}});});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const env={...process.env,ISP_API_URL:`http://127.0.0.1:${server.address().port}`,ISP_API_TOKEN:'test-token'};
 try{
  const output=await promisify(execFile)(process.execPath,['scripts/isp.mjs','viewer-request','image','--message','Choose ROI'],{env,windowsHide:true,timeout:10000});
  assert.equal(JSON.parse(output.stdout).status,'fulfilled');assert.equal(requests,1);assert.equal(waits,2);assert.match(output.stderr,/Still waiting/);
  const detached=await promisify(execFile)(process.execPath,['scripts/isp.mjs','viewer-request','image','--message','Choose ROI','--no-wait'],{env,windowsHide:true,timeout:10000});assert.equal(JSON.parse(detached.stdout).status,'pending');assert.equal(waits,2);
  waits=0;const resumed=await promisify(execFile)(process.execPath,['scripts/isp.mjs','viewer-wait',id],{env,windowsHide:true,timeout:10000});assert.equal(JSON.parse(resumed.stdout).status,'fulfilled');assert.equal(waits,2);assert.equal(requests,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
