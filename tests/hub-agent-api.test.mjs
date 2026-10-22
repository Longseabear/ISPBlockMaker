import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import {fileURLToPath} from 'node:url';
import {Interaction} from '../server/interaction.mjs';
import {installPersonalAgentApi} from '../server/personal-agent-api.mjs';
import {createHub} from '../server/hub.mjs';
import {installHubAgentApi} from '../server/hub-agent-api.mjs';

test('scope revocation while resolving a worker prevents dispatch',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-agent-revoke-'));
 const id=crypto.randomUUID();let release,entered;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const app=express();app.use(express.json());
 const gateway=installHubAgentApi(app,{stateRoot:dir,list:async()=>[{id,name:'fixture'}],url:()=>'',resolveTarget:async()=>{entered();await gate;return {origin:'http://127.0.0.1:1',token:'unused',workerId:id};}});
 app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{release();gateway.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const token=gateway.access.update('enable',[id],[{id}]);
 const request=fetch(`http://127.0.0.1:${server.address().port}/api/agent/v1/workspaces/${id}/sessions`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':'test'},body:'{}'});
 await started;gateway.access.update('disable',undefined,[{id}]);release();
 const response=await request;assert.equal(response.status,409);assert.match((await response.json()).error,/authorization changed/);
});

async function worker(folder){
 fs.mkdirSync(folder,{recursive:true});const token=crypto.randomUUID(),instance=crypto.randomUUID();let healthWorkspace=folder;
 const m=new Interaction({workspace:folder,env:{},launch:{command:process.execPath,args:[fileURLToPath(new URL('./fixtures/interaction-agent.mjs',import.meta.url))]}});
 const app=express();app.use(express.json());app.get('/health',(_req,res)=>res.json({app:'ISPBlockMaker',workspace:healthWorkspace,instance,agentApi:1}));
 installPersonalAgentApi(app,{current:()=>({workspace:folder,store:{get:()=>({diagrams:[],blocks:[],artifacts:[]})}}),interaction:{get:()=>m},authorize:req=>req.headers.authorization===`Bearer ${token}`});
 app.use((err,req,res,next)=>res.status(err.status||400).json({error:err.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}`;fs.writeFileSync(path.join(folder,'.isp/connection.json'),JSON.stringify({url,token,workspace:folder}));
 let closed=false;return {folder,m,token,url,changeIdentity:value=>healthWorkspace=value,async close(){if(closed)return;closed=true;await m.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
test('central API routes two workspaces with one token, isolates sessions and revokes streams',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-central-agent-')),stateRoot=path.join(temp,'state');fs.mkdirSync(stateRoot);const a=await worker(path.join(temp,'A')),b=await worker(path.join(temp,'B'));
 const projects=[a,b].map(w=>({id:crypto.randomUUID(),path:w.folder,lastOpened:null}));fs.writeFileSync(path.join(stateRoot,'hub-projects.json'),JSON.stringify(projects));let hub=await createHub({stateRoot,port:0}),bridgeToken='';
 t.after(async()=>{await hub.close();await a.close();await b.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10});});
 const call=async(route,body,key,admin=false)=>{const r=await fetch(hub.url+'/api'+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${admin?hub.token:bridgeToken}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 assert.equal((await call('/agent-settings',undefined,undefined,true)).body.enabled,false);assert.equal((await call('/agent/v1/workspaces',undefined,undefined,true)).status,401);
 assert.equal((await call('/agent-settings',{action:'enable',workspace_ids:[]},undefined,true)).status,400);
 bridgeToken=(await call('/agent-settings',{action:'enable',workspace_ids:[projects[0].id]},undefined,true)).body.token;
 assert.equal((await call('/projects')).status,401);assert.equal((await call('/agent/v1/workspaces')).body.workspaces.length,1);
 const pa='/agent/v1/workspaces/'+projects[0].id,pb='/agent/v1/workspaces/'+projects[1].id;
 assert.equal((await call(pb+'/sessions')).status,404);assert.equal((await call('/agent/v1/workspaces/current')).status,409);
 const sa=(await call(pa+'/sessions',{title:'A',provider:'codex'},'session')).body.session.id;assert.ok(sa);
 await call('/agent-settings',{action:'scope',workspace_ids:projects.map(p=>p.id)},undefined,true);
 const sb=(await call(pb+'/sessions',{title:'B',provider:'codex'},'session')).body.session.id;assert.notEqual(sa,sb);
 assert.equal((await call(pb+'/sessions/'+sa+'/messages',{text:'wrong'},'wrong')).status,404);
 const ra=(await call(pa+'/sessions/'+sa+'/messages',{text:'hello'},'message')).body.run_id,rb=(await call(pb+'/sessions/'+sb+'/messages',{text:'hello'},'message')).body.run_id;
 await until(()=>a.m.apiRuns[ra]?.status==='completed'&&b.m.apiRuns[rb]?.status==='completed');
 assert.equal((await call(pa+'/runs/'+ra)).body.run.output,'Hello world');assert.equal((await call(pb+'/runs/'+rb)).body.run.output,'Hello world');assert.equal((await call(pb+'/runs/'+ra)).status,404);
 assert.equal((await call('/agent/v1/sessions')).body.workspaces.length,2);assert.equal((await call('/agent/v1/runs')).body.workspaces.every(w=>w.runs.length===1),true);
 assert.equal((await call('/agent/v1/openapi.json')).body.openapi,'3.1.0');assert.equal((await call(pa+'/anything')).status,404);
 const stream=await fetch(hub.url+'/api'+pa+'/events?after=0',{headers:{Authorization:'Bearer '+bridgeToken}});assert.equal(stream.status,200);const reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/run.completed/);
 bridgeToken=(await call('/agent-settings',{action:'rotate'},undefined,true)).body.token;
 const closed=Promise.resolve().then(async()=>{for(;;){const r=await reader.read();if(r.done)return true;}});assert.equal(await Promise.race([closed,new Promise(r=>{const timer=setTimeout(()=>r(false),2000);timer.unref();})]),true);reader.releaseLock();
 assert.equal((await call(pa+'/sessions/'+sa+'/messages',{text:'hello'},'message')).body.run_id,ra);assert.equal(a.m.chats[0].items.filter(i=>i.type==='userMessage').length,1);
 const stored=fs.readFileSync(path.join(stateRoot,'agent-api.json'),'utf8');assert.ok(!stored.includes(bridgeToken));assert.ok(!JSON.stringify((await call('/agent/v1/workspaces')).body).includes(a.token));
 await hub.close();hub=await createHub({stateRoot,port:0});assert.equal((await call('/agent/v1/workspaces')).body.workspaces[0].id,projects[0].id);
 await b.close();assert.equal((await call(pb+'/sessions')).status,503);assert.equal((await call('/agent/v1/sessions')).body.workspaces.find(w=>w.workspace_id===projects[1].id).status,'unavailable');
 a.changeIdentity(b.folder);assert.equal((await call(pa+'/sessions')).status,409);a.changeIdentity(a.folder);
 await call('/agent-settings',{action:'disable'},undefined,true);assert.equal((await call(pa+'/sessions')).status,401);
});
