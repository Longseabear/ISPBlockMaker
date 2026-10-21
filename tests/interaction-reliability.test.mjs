import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import express from 'express';
import {Interaction,installInteraction} from '../server/interaction.mjs';
import {runClaude,safeClaudeError,claudeRuntimeAsync} from '../server/claude-interaction.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-reliable-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return dir;};
test('error preserves status and token-limit details while redacting credentials',()=>{
 const text=safeClaudeError({status:400,message:'context too long Bearer abcdef secret-value sk-abcdefgh'}, {ANTHROPIC_AUTH_TOKEN:'secret-value'});
 assert.match(text,/400.*context too long/);assert.doesNotMatch(text,/abcdef|secret-value|sk-/);
});
test('partial output survives a restart before the turn finishes',async t=>{
 const workspace=temp(t),m=new Interaction({workspace,env:{}});
 m.chats.push({id:'chat',threadId:'thread',busy:true,status:'inProgress',items:[]});
 m.receive({method:'item/agentMessage/delta',params:{threadId:'thread',itemId:'message',delta:'saved partial'}});
 await pause(1150);
 const restored=new Interaction({workspace,env:{}});
 assert.equal(restored.chats[0].status,'interrupted');assert.equal(restored.chats[0].items[0].text,'saved partial');
 await restored.close();await m.close();
});
test('large tool output is preserved outside transcript and API errors retain details',async t=>{
 const workspace=temp(t),chat={id:'c',items:[]},big='output'.repeat(10000);
 const run=runClaude({workspace,env:{},chat,text:'test',runtime:{file:'unused'},ask:()=>{},cancelPrompts:()=>{},save:()=>{},queryImpl:()=> (async function*(){
 yield {type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool',content:big}]}};
 yield {type:'result',is_error:true,subtype:'error_during_execution',errors:['400 context window exceeded']};
 })()});await run.done;
 assert.equal(chat.status,'failed');assert.match(chat.error,/400 context window exceeded/);
 assert.equal(chat.items[0].result.preview.length,24000);assert.equal(fs.readFileSync(path.join(workspace,chat.items[0].result.outputFile),'utf8'),big);
});
test('HTTP event stream delivers partial response before completion and reconnects with current state',{skip:process.platform!=='win32',timeout:12000},async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-stream-'));let advance,finish;
 const next=new Promise(r=>advance=r),end=new Promise(r=>finish=r);
 const app=express();app.use(express.json());
 const service=installInteraction(app,()=>({workspace,env:process.env,claudeQuery:()=> (async function*(){
 yield {type:'stream_event',event:{type:'message_start',message:{id:'a'}}};
 yield {type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Hello'}}};
 await next;
 yield {type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:' world'}}};
 await end;yield {type:'result',is_error:false};
 })()}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const control=new AbortController();
 t.after(async()=>{advance();finish();control.abort();await service.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const events=await fetch(origin+'/api/interaction/events',{signal:control.signal});const reader=events.body.getReader();const decoder=new TextDecoder();let buffer='';
 async function frame(){while(true){const at=buffer.indexOf('\n\n');if(at>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+2);if(line.startsWith('data: '))return JSON.parse(line.slice(6));}else{const result=await reader.read();assert.equal(result.done,false);buffer+=decoder.decode(result.value,{stream:true});}}}
 await frame();
 const send=await fetch(origin+'/api/interaction/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'stream'})});assert.equal(send.status,200);
 let event;do{event=await frame();}while(!event.updates.some(u=>u.item.text==='Hello'));
 assert.equal((await (await fetch(origin+'/api/interaction')).json()).chats[0].busy,true);
 advance();do{event=await frame();}while(!event.updates.some(u=>u.item.text==='Hello world'));
 assert.equal(event.updates.length,1);
 const reconnect=await fetch(origin+'/api/interaction/events',{signal:control.signal});const replay=await reconnect.body.getReader().read();assert.match(new TextDecoder().decode(replay.value),/Hello world/);
 finish();
});

test('company executable version probe does not block the event loop',{skip:process.platform!=='win32'},async()=>{
 let ticked=false;const timer=setTimeout(()=>{ticked=true;},0);
 const runtime=await claudeRuntimeAsync();clearTimeout(timer);
 assert.equal(ticked,true);assert.match(runtime.engineVersion,/^\d+\.\d+\.\d+$/);
});
test('tool starts appear before the final assistant message',async t=>{
 const workspace=temp(t),chat={id:'progress',items:[]};let release;const gate=new Promise(r=>release=r);
 const run=runClaude({workspace,env:{},chat,text:'test',runtime:{file:'unused'},ask:()=>{},cancelPrompts:()=>{},save:()=>{},queryImpl:()=> (async function*(){
 yield {type:'stream_event',event:{type:'content_block_start',content_block:{id:'early-tool',type:'tool_use',name:'Read'}}};await gate;yield {type:'result',is_error:false};
 })()});await pause(10);assert.equal(chat.phase,'tool');assert.equal(chat.items[0].tool,'Read');release();await run.done;
});
