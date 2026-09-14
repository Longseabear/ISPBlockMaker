import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {spawn,execFileSync,execFile} from "node:child_process";
import {promisify} from "node:util";
import {once} from "node:events";
import {WebSocket} from "ws";

test("Viewer authenticates imports, presents requests, persists exact user crops and rejects resubmission",{timeout:60000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"isp-viewer-"));const probe=net.createServer().listen(0,"127.0.0.1");await once(probe,"listening");const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,["server/index.mjs"],{env:{...process.env,ISP_WORKSPACE:temp,ISP_STATE_HOME:path.join(temp,"state"),PORT:String(port)},windowsHide:true,stdio:["ignore","pipe","pipe"]});const exited=once(child,"exit");let socket;
 const external=path.join(os.tmpdir(),`external image ${path.basename(temp)}.raw`);
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Startup timeout")),15000);child.stdout.on("data",d=>{if(String(d).includes("ISP Block Maker")){clearTimeout(timer);resolve();}});});
  const base=`http://127.0.0.1:${port}`,boot=await(await fetch(base+"/api/bootstrap")).json();const headers={Authorization:`Bearer ${boot.token}`,"Content-Type":"application/json"};
  const post=(route,body)=>fetch(base+"/api"+route,{method:"POST",headers,body:JSON.stringify(body)});
  assert.equal((await fetch(base+"/api/viewer")).status,401);
  const data=Buffer.alloc(8*8*2);for(let i=0;i<64;i++)data.writeUInt16LE(i*7,i*2);fs.writeFileSync(path.join(temp,"input.raw"),data);const spec={format:"raw",width:8,height:8,bitDepth:10,pattern:"GRBG",group:4};fs.writeFileSync(path.join(temp,"spec.json"),JSON.stringify(spec));
  fs.writeFileSync(external,data);
  const externalImport=JSON.parse(execFileSync(process.execPath,[path.join(temp,".isp/tools/isp.mjs"),"viewer-import",external,"--spec","spec.json"],{cwd:temp,windowsHide:true,encoding:"utf8"}));
  assert.deepEqual(fs.readFileSync(external),data);
  assert.deepEqual(fs.readFileSync(path.join(temp,".isp/viewer",externalImport.id+".bin")),data);
  fs.writeFileSync(external,Buffer.alloc(data.length));
  assert.deepEqual(fs.readFileSync(path.join(temp,".isp/viewer",externalImport.id+".bin")),data);
  assert.equal((await post("/viewer/images/import",{path:os.tmpdir(),spec})).status,400);
  assert.equal((await post("/viewer/images/import",{path:external,spec:{format:"bmp"}})).status,400);
  const imported=JSON.parse(execFileSync(process.execPath,[path.join(temp,".isp/tools/isp.mjs"),"viewer-import","input.raw","--spec","spec.json"],{cwd:temp,windowsHide:true,encoding:"utf8"}));
  const upload=await fetch(base+"/api/viewer/images",{method:"POST",headers:{Authorization:`Bearer ${boot.token}`,"Content-Type":"application/octet-stream","X-Image-Metadata":encodeURIComponent(JSON.stringify({name:"uploaded.raw",spec}))},body:data});assert.equal(upload.status,201);assert.equal((await upload.json()).sha256,imported.sha256);
  socket=new WebSocket(`ws://127.0.0.1:${port}/ws?token=${boot.token}`);await once(socket,"open");
  const presented=new Promise(resolve=>socket.on("message",d=>{const m=JSON.parse(d);if(m.type==="present")resolve(m.presentation);}));
  const request=await(await post("/viewer/requests",{imageId:imported.id,prompt:"Select flat area",blockId:"input"})).json();assert.equal(request.status,"pending");assert.equal((await presented).requestId,request.id);
  assert.equal((await post(`/viewer/requests/${request.id}/submit`,{x:7,y:7,width:2,height:2})).status,400);
  assert.equal((await post(`/viewer/requests/${request.id}/submit`,{x:1,y:2,width:3,height:2})).status,400);
  const waiting=promisify(execFile)(process.execPath,[path.join(temp,".isp/tools/isp.mjs"),"viewer-result",request.id,"--wait","5"],{cwd:temp,windowsHide:true});
  const result=await(await post(`/viewer/requests/${request.id}/submit`,{x:0,y:0,width:8,height:8})).json();assert.equal(result.status,"submitted");assert.deepEqual(result.result.output.cfaOrigin,{x:0,y:0});
  assert.equal(JSON.parse((await waiting).stdout).status,"submitted");
  const crop=fs.readFileSync(path.join(temp,result.result.paths.crop));assert.equal(crop.readUInt16LE(),0);assert.equal(crop.length,128);
  assert.equal((await post(`/viewer/requests/${request.id}/submit`,{x:0,y:0,width:1,height:1})).status,409);
  const downloaded=await fetch(base+`/api/viewer/requests/${request.id}/files/crop`,{headers});assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),crop);
  const preview=await(await fetch(base+`/api/viewer/images/${imported.id}/preview`,{headers})).json();assert.match(preview.url,/^data:image\/png;base64,/);
  const cancelled=await(await post("/viewer/requests",{imageId:imported.id,prompt:"Cancel me",show:false})).json();await post(`/viewer/requests/${cancelled.id}/cancel`,{});assert.equal((await post(`/viewer/requests/${cancelled.id}/submit`,{x:0,y:0,width:1,height:1})).status,409);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp,".isp/viewer/requests.json"),"utf8"))[0].status,"submitted");
 }finally{if(fs.existsSync(external))fs.unlinkSync(external);socket?.terminate();child.kill();await exited;fs.rmSync(temp,{recursive:true,force:true});}
});
