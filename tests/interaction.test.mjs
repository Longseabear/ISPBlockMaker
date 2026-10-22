import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Interaction} from '../server/interaction.mjs';
const launch={command:process.execPath,args:[fileURLToPath(new URL('./fixtures/interaction-agent.mjs',import.meta.url))]};
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');}
test('structured turns stream, persist, resume, queue concurrent sends and interrupt',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-interaction-'));const app=new Interaction({workspace,env:process.env,launch});t.after(async()=>{await app.close();fs.rmSync(workspace,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
 await app.connect();assert.equal(app.snapshot().connected,true);
 const {id}=await app.send({provider:'codex',text:'hello',blockId:'input'});await until(()=>!app.chats[0].busy&&!app.chats[0].queue?.length);assert.equal(app.chats[0].items.at(-1).text,'Hello world');assert.equal(app.chats[0].items.filter(i=>i.type==='agentMessage').length,1);
 await app.send({chatId:id,text:'wait',blockId:'other'});await until(()=>app.chats[0].busy&&!!app.chats[0].turnId);assert.equal(app.chats[0].blockId,'input');const queued=await app.send({chatId:id,text:'double'});assert.equal(app.chats[0].queue[0].text,'double');await app.queue.edit(id,{id:queued.queueId,remove:true});
 await app.interrupt(id);await until(()=>!app.chats[0].busy&&!app.chats[0].queue?.length);assert.equal(app.chats[0].status,'interrupted');await app.close();
 const restored=new Interaction({workspace,env:process.env,launch});try{assert.equal(restored.chats[0].loaded,false);await restored.send({chatId:id,text:'resume'});await until(()=>!restored.chats[0].busy&&!restored.chats[0].queue?.length);assert.equal(restored.chats[0].items.filter(i=>i.type==='userMessage').length,3);}finally{await restored.close();}
});
test('approvals require an explicit valid answer and cannot be replayed',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-approval-'));const app=new Interaction({workspace,env:process.env,launch});t.after(async()=>{await app.close();fs.rmSync(workspace,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
 await app.send({provider:'codex',text:'approve'});await until(()=>app.requests.size===1);assert.equal(app.chats[0].busy,true);
 assert.throws(()=>app.answer({id:900,decision:'acceptForSession'}));assert.equal(app.requests.size,1);
 app.answer({id:900,decision:'decline'});assert.throws(()=>app.answer({id:900,decision:'accept'}),/만료/);await until(()=>!app.chats[0].busy&&!app.chats[0].queue?.length);
 app.receive({id:901,method:'item/tool/requestUserInput',params:{threadId:'test-thread',questions:[{id:'format',question:'Choose format'}]}});
 assert.throws(()=>app.answer({id:901}));app.answer({id:901,answers:{format:['PNG']}});assert.equal(app.requests.size,0);
 await assert.rejects(()=>app.send({chatId:'11111111-1111-4111-8111-111111111111',text:'foreign'}),/작업 폴더/);
});

test('Codex model changes apply to each subsequent turn, including returning to the default',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-model-'));const app=new Interaction({workspace,env:process.env,launch});t.after(async()=>{await app.close();fs.rmSync(workspace,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
 const turns=[];const rpc=app.rpc.bind(app);app.rpc=(method,params)=>{if(method==='turn/start')turns.push(params);return rpc(method,params);};
 const {id}=await app.send({provider:'codex',text:'one',model:'first'});await until(()=>!app.chats[0].busy&&!app.chats[0].queue?.length);
 await app.send({chatId:id,text:'two',model:'second'});await until(()=>!app.chats[0].busy&&!app.chats[0].queue?.length);
 app.models=[{model:'default-model',isDefault:true}];await app.send({chatId:id,text:'three',model:''});await until(()=>!app.chats[0].busy&&!app.chats[0].queue?.length);
 assert.deepEqual(turns.map(p=>p.model),['first','second','default-model']);
});

test('chat names persist independently of engine sessions and deletion refuses active work',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-chat-management-'));const app=new Interaction({workspace,env:process.env,launch});t.after(async()=>{await app.close();fs.rmSync(workspace,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
 const {id}=await app.send({provider:'codex',text:'hello'});await until(()=>!app.chats[0].busy);const threadId=app.chats[0].threadId;
 assert.throws(()=>app.rename(id,'   '));assert.throws(()=>app.rename('missing','Name'));
 app.rename(id,'  검증 작업  ');assert.equal(app.chats[0].title,'검증 작업');assert.equal(app.chats[0].threadId,threadId);await app.flushSaves();
 const restored=new Interaction({workspace,env:process.env,launch});assert.equal(restored.chats[0].title,'검증 작업');await restored.close();
 app.chats[0].busy=true;assert.throws(()=>app.remove(id),/실행 중/);app.chats[0].busy=false;app.remove(id);assert.equal(app.chats.length,0);
});
