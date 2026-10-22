import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {fileURLToPath} from 'node:url';
import {Interaction} from '../server/interaction.mjs';
import {installPersonalAgentApi,agentWorkspaceId} from '../server/personal-agent-api.mjs';

async function fixture(t,{realAdapter=false}={}){
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-personal-api-'));let currentWorkspace=workspace;
 const m=new Interaction({workspace,env:{},...(realAdapter?{launch:{command:process.execPath,args:[fileURLToPath(new URL('./fixtures/interaction-agent.mjs',import.meta.url))]}}:{})});const started=[];
 if(!realAdapter){
 m.sendNow=async({chatId,text})=>{const c=m.chats.find(c=>c.id===chatId);started.push(text);c.busy=true;c.status='inProgress';c.items.push({id:crypto.randomUUID(),type:'userMessage',text});await m.save(true);return {id:c.id};};
 m.interrupt=async id=>{const c=m.chats.find(c=>c.id===id);c.busy=false;c.status='interrupted';c.queuePaused=true;await m.save(true);return {ok:true};};
 }
 const app=express();app.use(express.json());installPersonalAgentApi(app,{current:()=>({workspace:currentWorkspace,store:{get:()=>({diagrams:[{id:'main'}],blocks:[]})}}),interaction:{get:()=>m},authorize:req=>req.headers.authorization==='Bearer test-only-worker'});app.use((err,req,res,next)=>res.status(err.status||400).json({error:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await m.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(workspace,{recursive:true,force:true,maxRetries:10});});
 let token='test-only-worker';const call=async(route,body,key,method)=>{const response=await fetch(origin+route,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
 const base='/api/internal/agent/v1/workspaces/'+agentWorkspaceId(workspace);
 return {workspace,m,started,base,call,origin,get token(){return token;},setToken:value=>token=value,setWorkspace:value=>currentWorkspace=value};
}
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Condition timed out');};

test('personal API pins workspace and session, deduplicates requests and keeps results per run',async t=>{
 const f=await fixture(t),{m,base,call}=f;
 const current=await call('/api/internal/agent/v1/workspaces/current');assert.equal(current.body.workspace.id,agentWorkspaceId(f.workspace));
 assert.equal((await call('/api/personal-agent',{action:'enable'})).status,410);assert.equal((await call('/api/agent/v1/workspaces/current')).status,410);
 const created=await call(base+'/sessions',{title:'Messenger',provider:'claude'},'session-one');assert.equal(created.status,201);const id=created.body.session.id;
 assert.equal((await call(base+'/sessions',{title:'Messenger',provider:'claude'},'session-one')).body.session.id,id);
 assert.equal((await call(base+'/sessions',{title:'Changed'},'session-one')).status,409);
 assert.equal((await call(base+'/sessions/missing/messages',{text:'bad'},'bad-session')).status,404);
 const route=base+'/sessions/'+id+'/messages';
 const [one,replay]=await Promise.all([call(route,{text:'first'},'message-one'),call(route,{text:'first'},'message-one')]);assert.equal(one.status,202);assert.equal(one.body.run_id,replay.body.run_id);
 assert.equal((await call(route,{text:'different'},'message-one')).status,409);
 assert.equal((await call(route,{text:'steer',delivery:'steer'},'unsupported')).status,400);
 await until(()=>f.started.length===1);const two=await call(route,{text:'second'},'message-two');assert.equal(two.status,202);
 const chat=m.chats.find(c=>c.id===id);chat.items.push({id:'response-1',type:'agentMessage',text:'first result'});chat.busy=false;chat.status='completed';await m.save(true);
 await until(()=>f.started.length===2);let first=await call(base+'/runs/'+one.body.run_id);assert.equal(first.body.run.status,'completed');assert.equal(first.body.run.output,'first result');
 chat.items.push({id:'response-2',type:'agentMessage',text:'second result'});chat.busy=false;chat.status='completed';await m.save(true);
 assert.equal((await call(base+'/runs/'+two.body.run_id)).body.run.output,'second result');assert.equal((await call(base+'/runs/'+one.body.run_id)).body.run.output,'first result');
 assert.equal(Object.keys(m.apiRuns).length,2);assert.ok(!JSON.stringify(first.body).includes('message-one'));
 f.setWorkspace(f.workspace+'-other');assert.equal((await call(base+'/sessions')).status,409);
 f.setWorkspace(f.workspace);assert.equal((await call(base.replace(agentWorkspaceId(f.workspace),'wrong')+'/sessions')).status,409);
 m.remove(id);await m.flushSaves();assert.equal((await call(base+'/sessions',{title:'Messenger',provider:'claude'},'session-one')).status,410);assert.equal((await call(base+'/runs/'+one.body.run_id)).body.run.output,'first result');
});

test('queued cancellation, owned questions, worker authorization and event replay are explicit',async t=>{
 const f=await fixture(t),{base,call,m}=f;const a=(await call(base+'/sessions',{title:'A'},'a')).body.session.id;
 const one=await call(base+'/sessions/'+a+'/messages',{text:'running'},'one');await until(()=>f.started.length===1);
 const two=await call(base+'/sessions/'+a+'/messages',{text:'queued'},'two');
 const cancelled=await call(base+'/runs/'+two.body.run_id+'/cancel',{});assert.equal(cancelled.body.run.status,'cancelled');assert.equal(m.chats[0].queue.length,0);
 const removed=await call(base+'/sessions/'+a+'/messages',{text:'remove in UI'},'remove');await m.queue.edit(a,{id:removed.body.run_id,remove:true});assert.equal((await call(base+'/runs/'+removed.body.run_id)).body.run.status,'cancelled');
 m.requests.set('other-question',{params:{chatId:'not-this-session'}});
 assert.equal((await call(base+'/runs/'+one.body.run_id+'/answers',{request_id:'other-question',decision:'accept'})).status,409);m.requests.delete('other-question');
 m.requests.set('question',{params:{chatId:a}});assert.equal((await call(base+'/runs/'+one.body.run_id)).body.run.status,'waiting_input');m.requests.delete('question');
 const controller=new AbortController();const response=await fetch(f.origin+base+'/events?after=0',{headers:{Authorization:'Bearer '+f.token},signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();const received=new TextDecoder().decode((await reader.read()).value);assert.match(received,/event: run.queued/);controller.abort();await reader.cancel().catch(()=>{});
 const stopped=await call(base+'/runs/'+one.body.run_id+'/cancel',{});assert.equal(stopped.body.run.status,'cancelled');
 assert.equal((await call(base+'/events?after=999999')).status,409);
 f.setToken('invalid');assert.equal((await call(base+'/sessions')).status,401);f.setToken('test-only-worker');assert.equal((await call(base+'/sessions')).status,200);
 assert.equal((await call(base+'/sessions/'+a+'/messages',{text:'running'},'one')).body.run_id,one.body.run_id);
 assert.equal(fs.existsSync(path.join(f.workspace,'.isp/personal-agent-api.json')),false);
});

test('personal API executes through the real Codex protocol adapter and returns its result',async t=>{
 const f=await fixture(t,{realAdapter:true}),{base,call,m}=f;const id=(await call(base+'/sessions',{provider:'codex'},'codex-session')).body.session.id;
 const run=(await call(base+'/sessions/'+id+'/messages',{text:'hello'},'codex-message')).body.run_id;
 await until(()=>m.apiRuns[run].status==='completed');const result=await call(base+'/runs/'+run);assert.equal(result.body.run.output,'Hello world');assert.equal(m.chats[0].items.filter(i=>i.type==='userMessage').length,1);
 const approval=(await call(base+'/sessions/'+id+'/messages',{text:'approve'},'approval-message')).body.run_id;await until(()=>m.apiRuns[approval].status==='waiting_input');const question=(await call(base+'/runs/'+approval)).body.questions[0];assert.ok(question);
 assert.equal((await call(base+'/runs/'+approval+'/answers',{request_id:question.id,decision:'decline'})).status,200);await until(()=>m.apiRuns[approval].status==='completed');
});

test('restart keeps completed results and interrupts pending work without executing it again',async t=>{
 const f=await fixture(t),{base,call,m}=f;const id=(await call(base+'/sessions',{},'session')).body.session.id;
 const one=await call(base+'/sessions/'+id+'/messages',{text:'first'},'one');await until(()=>f.started.length===1);
 const two=await call(base+'/sessions/'+id+'/messages',{text:'second'},'two');await m.flushSaves();
 const saved=fs.readFileSync(m.file,'utf8');const recoveredFolder=fs.mkdtempSync(path.join(os.tmpdir(),'isp-agent-restart-'));fs.mkdirSync(path.join(recoveredFolder,'.isp'));fs.writeFileSync(path.join(recoveredFolder,'.isp/interaction.json'),saved);
 const recovered=new Interaction({workspace:recoveredFolder,env:{}});try{assert.equal(recovered.apiRuns[one.body.run_id].status,'interrupted');assert.equal(recovered.apiRuns[two.body.run_id].status,'interrupted');assert.equal(recovered.chats[0].queue.length,0);assert.equal(recovered.chats[0].busy,false);}finally{await recovered.close();fs.rmSync(recoveredFolder,{recursive:true,force:true,maxRetries:10});}
});
