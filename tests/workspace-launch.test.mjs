import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {spawn} from "node:child_process";
import {once} from "node:events";

test("folder servers keep separate context and refuse in-place workspace switching",{timeout:60000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"isp-multi-"));const running=[];
 try {
  for(const name of ["작업 A","B"]) {
   const workspace=path.join(temp,name);fs.mkdirSync(workspace);
   const probe=net.createServer().listen(0,"127.0.0.1");await once(probe,"listening");const port=probe.address().port;await new Promise(r=>probe.close(r));
   const child=spawn(process.execPath,["server/index.mjs"],{env:{...process.env,PORT:String(port),ISP_WORKSPACE:workspace,ISP_STATE_HOME:path.join(temp,"state")},windowsHide:true,stdio:["ignore","pipe","pipe"]});
   const exited=once(child,"exit");const item={child,exited,workspace,url:`http://127.0.0.1:${port}`};running.push(item);
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Startup timeout")),15000);child.stdout.on("data",bytes=>{if(String(bytes).includes("ISP Block Maker")){clearTimeout(timeout);resolve();}});child.once("exit",()=>{clearTimeout(timeout);reject(new Error("Startup failed"));});});
   const health=await(await fetch(item.url+"/health")).json();assert.equal(health.workspace,fs.realpathSync(workspace));
   const boot=await(await fetch(item.url+"/api/bootstrap")).json();item.headers={Authorization:`Bearer ${boot.token}`,"Content-Type":"application/json"};item.instance=health.instance;
   assert.equal(JSON.parse(fs.readFileSync(path.join(workspace,".isp/connection.json"),"utf8")).url,item.url);
  }
  const [a,b]=running;
  assert.equal((await fetch(a.url+"/api/workspace",{method:"POST",headers:a.headers,body:JSON.stringify({path:b.workspace,stopTerminals:true})})).status,409);
  await fetch(a.url+"/api/documents/request",{method:"POST",headers:a.headers,body:"{}"});
  const project=await(await fetch(b.url+"/api/project",{headers:b.headers})).json();assert.equal(project.globalWork.userRequests.length,0);
  for(const item of running){await fetch(item.url+"/api/shutdown",{method:"POST",headers:item.headers,body:JSON.stringify({instance:item.instance})});await item.exited;assert.equal(fs.existsSync(path.join(item.workspace,".isp/connection.json")),false);}
 } finally {for(const item of running){if(item.child.exitCode===null)item.child.kill();await item.exited;}fs.rmSync(temp,{recursive:true,force:true});}
});
