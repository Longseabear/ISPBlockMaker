import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import {openWorkspace} from '../server/workspaces.mjs';
import {createReferenceSet,listReferenceSets,appendReferenceFile,compareReferenceFiles,installReferenceSets} from '../server/reference-sets.mjs';
import {packBundle,unpackBundle} from '../server/bundles.mjs';
import {openZip} from '../server/bundle-zip.mjs';

function fixture(){const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-reference-test-')),w=path.join(temp,'work');fs.mkdirSync(w);openWorkspace(w,process.cwd());fs.mkdirSync(path.join(w,'tmp'));return {temp,w,cleanup:()=>{assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));assert.match(path.basename(temp),/^isp-reference-test-/);fs.rmSync(temp,{recursive:true,force:true});}};}
test('Optional I/O sets allow zero or many block links, preserve bytes, compare explicitly and survive selective bundles',async()=>{
 const {temp,w,cleanup}=fixture();try{
  const original=Buffer.from([0,0,255,3]);fs.writeFileSync(path.join(w,'tmp/input.raw'),original);
  const set=createReferenceSet(w,{title:'Pipeline boundary',blockIds:['flat','variance','threshold'],files:[{name:'input.raw',path:'tmp/input.raw',metadata:{dtype:'uint16',shape:[1,2],pattern:'GRBG',bitDepth:10}}]});
  fs.writeFileSync(path.join(w,'tmp/input.raw'),Buffer.from([1]));assert.deepEqual(fs.readFileSync(path.join(w,'.isp/reference-sets',set.id,set.files[0].file)),original);
  const updated=appendReferenceFile(w,set.id,{name:'C model output.raw',role:'output',metadata:{entry:'private_framework_process'}},Buffer.from([0,0,254,3,9]));
  const result=compareReferenceFiles(w,set.id,updated.files[0].id,updated.files[1].id);assert.equal(result.equal,false);assert.equal(result.differentBytes,2);assert.deepEqual(result.firstDifferences,[{offset:2,expected:255,actual:254}]);
  assert.equal(compareReferenceFiles(w,set.id,updated.files[0].id,updated.files[0].id).equal,true);
  const free=createReferenceSet(w,{title:'No required mapping'});assert.deepEqual(free.blockIds,[]);assert.equal(free.checkpointId,null);
  const output=path.join(temp,'set.bundle');await packBundle(w,output,{includeImages:false,includeViewer:false,includeData:false,includeVisualizations:false});const restored=path.join(temp,'copy');await unpackBundle(output,restored);assert.equal(listReferenceSets(restored).length,2);assert.deepEqual(fs.readFileSync(path.join(restored,'.isp/reference-sets',set.id,set.files[0].file)),original);
 }finally{cleanup();}
});
test('Crop delivery copies every grouped region with its own spec and never consumes the delivery',()=>{
 const {w,cleanup}=fixture();try{const imageId=crypto.randomUUID(),requestId=crypto.randomUUID(),cropId=crypto.randomUUID(),deliveryId=crypto.randomUUID(),regions=[0,1].map(i=>({roi:{x:i*2,y:0,width:2,height:2},output:{format:'raw',width:2,height:2,bitDepth:12,pattern:'GRBG',group:1},paths:{crop:`tmp/crop-${i}.raw`}}));
  for(const [i,r] of regions.entries())fs.writeFileSync(path.join(w,r.paths.crop),Buffer.alloc(8,i));const viewer=path.join(w,'.isp/viewer');fs.mkdirSync(viewer,{recursive:true});fs.writeFileSync(path.join(viewer,'requests.json'),JSON.stringify([{id:requestId,imageId,crops:[{id:cropId,regions}]}]));const delivery={id:deliveryId,imageId,status:'pending',items:[{requestId,cropId}]};fs.writeFileSync(path.join(viewer,'crop-selection.json'),JSON.stringify([delivery]));
  const set=createReferenceSet(w,{title:'Two ROIs',cropDeliveryId:deliveryId});assert.equal(set.files.length,2);assert.equal(set.files[1].metadata.roi.x,2);assert.equal(set.files[0].metadata.spec.bitDepth,12);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(viewer,'crop-selection.json'),'utf8')),[delivery]);
  assert.throws(()=>createReferenceSet(w,{title:'Stale',cropDeliveryId:crypto.randomUUID()}),/변경/);assert.equal(listReferenceSets(w).length,1);
 }finally{cleanup();}
});
test('Failed registration is rolled back and outside or linked paths cannot be copied',()=>{
 const {temp,w,cleanup}=fixture();try{const outside=path.join(temp,'private.bin');fs.writeFileSync(outside,'secret');assert.throws(()=>createReferenceSet(w,{title:'Invalid',files:[{name:'x',path:outside}]}),/inside/);assert.equal(listReferenceSets(w).length,0);
  const link=path.join(w,'tmp/link');fs.symlinkSync(temp,link,'junction');assert.throws(()=>createReferenceSet(w,{title:'Linked',files:[{name:'x',path:'tmp/link/private.bin'}]}),/Linked/);fs.unlinkSync(link);assert.equal(fs.readFileSync(outside,'utf8'),'secret');
  assert.throws(()=>createReferenceSet(w,{title:'Invalid metadata',files:[{name:'x',path:'missing'}]}));assert.equal(listReferenceSets(w).length,0);
 }finally{cleanup();}
});
test('HTTP upload, export, optimistic edit/delete and download retain owned files and original input',async()=>{
 const {temp,w,cleanup}=fixture(),app=express();app.use(express.json());installReferenceSets(app,{current:()=>({workspace:w})});app.use((e,req,res,next)=>res.status(400).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/reference-sets`;
 const post=(url,body,method='POST')=>fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{const created=await (await post(base,{title:'HTTP set'})).json();const response=await fetch(base+'/'+created.id+'/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Reference-Metadata':encodeURIComponent(JSON.stringify({name:'result.bin',role:'output',metadata:{producer:'c-model'}}))},body:Buffer.from([4,5,6])});assert.equal(response.status,201);const set=await response.json();assert.notEqual(set.updatedAt,created.updatedAt);
  const file=await fetch(base+'/'+set.id+'/files/'+set.files[0].id);assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from([4,5,6]));const zipResponse=await fetch(base+'/'+set.id+'/export');assert.equal(zipResponse.status,200);const zipPath=path.join(temp,'export.zip');fs.writeFileSync(zipPath,Buffer.from(await zipResponse.arrayBuffer()));const zip=await openZip(zipPath);try{assert.equal(zip.entries.length,2);assert.equal(JSON.parse((await zip.read(zip.entries.find(e=>e.path==='manifest.json'))).toString()).title,'HTTP set');}finally{await zip.close();}
  assert.equal((await post(base+'/'+set.id,{updatedAt:created.updatedAt},'DELETE')).status,409);const patched=await (await post(base+'/'+set.id,{updatedAt:set.updatedAt,description:'optional freeform'},'PATCH')).json();assert.equal(patched.files.length,1);assert.equal((await post(base+'/'+set.id,{updatedAt:patched.updatedAt},'DELETE')).status,200);assert.deepEqual(listReferenceSets(w),[]);
 }finally{await new Promise(r=>server.close(r));cleanup();}
});
