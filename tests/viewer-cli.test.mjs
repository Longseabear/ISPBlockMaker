import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import {installViewer} from '../server/viewer.mjs';

test('Viewer CLI keeps image bytes out of text context and bounds numeric inspection', async t => {
  const calls=[];
  const server=http.createServer(async (req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    calls.push({url:req.url,method:req.method,body:body?JSON.parse(body):undefined});
    assert.equal(req.headers.authorization,'Bearer cli-test-token');
    res.setHeader('Content-Type','application/json');
    if(req.url.includes('/attachment'))res.end(JSON.stringify(req.url.includes('vision=true')?{content:[{type:'image',data:'x'.repeat(100_000)}]}:{live:{imageId:'sample',paths:{image:'C:/workspace/.isp/viewer/current-view.png'}},imageSupported:false}));
    else if(req.url==='/api/viewer/crop-selection')res.end(JSON.stringify({id:'delivery',status:'pending',purpose:'white_balance',crops:[]}));
    else res.end(JSON.stringify({ok:true}));
  }).listen(0,'127.0.0.1');
  await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const run=(...args)=>promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/isp.mjs',import.meta.url)),...args],{windowsHide:true,env:{...process.env,ISP_API_URL:`http://127.0.0.1:${server.address().port}`,ISP_API_TOKEN:'cli-test-token'}});

  const vision=await run('viewer-image','current','--vision');
  assert.ok(vision.stdout.length<2000);
  assert.equal(JSON.parse(vision.stdout).nativeImage.path,'C:/workspace/.isp/viewer/current-view.png');
  assert.equal(JSON.parse(vision.stdout).content,undefined);
  assert.equal(calls.at(-1).url,'/api/viewer/current/attachment');

  await run('viewer-pixels','sample','--roi','8,12,16,16');
  const pixels=new URL(calls.at(-1).url,'http://local');
  assert.equal(pixels.pathname,'/api/viewer/images/sample/pixels');
  assert.equal(pixels.searchParams.get('x'),'8');
  const count=calls.length;
  await assert.rejects(run('viewer-pixels','sample','--roi','0,0,17,16'),/256 source pixels/);
  await assert.rejects(run('viewer-pixels','sample','--roi','0,,2,2'),/--roi/);
  await assert.rejects(run('viewer-stats','sample'),/--roi/);
  await assert.rejects(run('viewer-stats','sample','--roi','0,0,2,2','--black','NaN'),/finite number/);
  assert.equal(calls.length,count,'Invalid or oversized inspection must not read pixel data');

  await run('viewer-stats','sample','--roi','0,0,100,100','--black','64','--white','1023');
  const stats=new URL(calls.at(-1).url,'http://local');
  assert.equal(stats.pathname,'/api/viewer/images/sample/statistics');
  assert.equal(stats.searchParams.get('black'),'64');
  assert.equal(stats.searchParams.get('white'),'1023');
  await run('viewer-crop-stats','delivery','--black','64');
  assert.deepEqual(calls.at(-1),{url:'/api/viewer/crop-selection/delivery/statistics',method:'POST',body:{black:64}});
  await run('viewer-request','sample','--purpose','white_balance','--message','Select a neutral patch','--no-show','--no-wait');
  assert.equal(calls.at(-1).body.purpose,'white_balance');
  assert.equal(calls.at(-1).body.show,false);
  await assert.rejects(run('viewer-request','sample','--purpose','wrong','--message','Select'),/--purpose/);

  const delivery=JSON.parse((await run('viewer-crops')).stdout);
  assert.equal(delivery.status,'pending');
  assert.equal(calls.at(-1).method,'GET','Reading delivery metadata must not consume it');
  await assert.rejects(run('viewer-crops-ack','delivery'),/--note/);
  await run('viewer-crops-ack','delivery','--note','Measured WB; neutral patch unconfirmed');
  assert.deepEqual(calls.at(-1),{url:'/api/viewer/crop-selection/delivery/ack',method:'POST',body:{resolution:'Measured WB; neutral patch unconfirmed'}});
});

test('Viewer CLI reads actual crop statistics and acknowledges only the handled delivery', async t => {
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-viewer-cli-'));
  const app=express();app.use(express.json());
  installViewer(app,{current:()=>({workspace,state:{revision:1,blocks:[]}}),present:()=>0});
  app.use((error,req,res,next)=>res.status(400).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(workspace),path.resolve(os.tmpdir()));
    assert.ok(path.basename(workspace).startsWith('isp-viewer-cli-'));
    fs.rmSync(workspace,{recursive:true,force:true});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(route,body)=>{const response=await fetch(base+'/api'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.ok,true,JSON.stringify(result));return result;};
  const run=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/isp.mjs',import.meta.url)),...args],{windowsHide:true,env:{...process.env,ISP_API_URL:base,ISP_API_TOKEN:'fixture'}})).stdout);
  const values=[200,400,200,400,400,100,400,100,200,400,200,400,400,100,400,100],bytes=Buffer.alloc(32);
  values.forEach((value,index)=>bytes.writeUInt16LE(value,index*2));
  const raw=path.join(workspace,'image.raw');fs.writeFileSync(raw,bytes);
  const image=await post('/viewer/images/import',{path:raw,spec:{format:'raw',width:4,height:4,bitDepth:12,pattern:'RGGB',group:1}});
  const pixels=await run('viewer-pixels',image.id,'--roi','0,0,2,2');assert.deepEqual(pixels.values,[200,400,400,100]);
  const stats=await run('viewer-stats',image.id,'--roi','0,0,4,4','--black','0');assert.deepEqual(stats.whiteBalance.gains,{R:2,G:1,B:4});
  const request=await run('viewer-request',image.id,'--message','Select neutral patches','--purpose','white_balance','--no-show','--no-wait');assert.equal(request.purpose,'white_balance');
  const cropId=crypto.randomUUID();await post(`/viewer/requests/${request.id}/crops`,{id:cropId,rois:[{x:0,y:0,width:2,height:2},{x:2,y:2,width:2,height:2}],description:'Two neutral patches'});
  const selection={imageId:image.id,purpose:'white_balance',items:[{requestId:request.id,cropId}]};
  const delivered=await post('/viewer/crop-selection',selection);
  assert.equal((await run('viewer-crops')).status,'pending');
  const cropStats=await run('viewer-crop-stats',delivered.id,'--black','0');assert.equal(cropStats.results.length,2);assert.deepEqual(cropStats.aggregate.whiteBalance.gains,{R:2,G:1,B:4});
  assert.equal((await run('viewer-crops')).status,'pending','Statistics do not implicitly consume user work');
  assert.equal((await run('viewer-crops-ack',delivered.id,'--note','Measured neutral patch gain estimate')).status,'consumed');
  const next=await post('/viewer/crop-selection',selection);
  await assert.rejects(run('viewer-crops-ack',delivered.id,'--note','stale result'),/delivery changed/);
  const unchanged=await run('viewer-crops');assert.equal(unchanged.id,next.id);assert.equal(unchanged.status,'pending');
});
