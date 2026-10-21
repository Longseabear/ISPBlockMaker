import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Interaction} from '../server/interaction.mjs';
import {ClaudePrompts} from '../server/claude-prompts.mjs';
import {claudeRuntime} from '../server/claude-interaction.mjs';
const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};

test('company Windows binary is used instead of SDK bundled binary',{skip:process.platform!=='win32'},()=>{
 const r=claudeRuntime();assert.equal(r.sdkVersion,'0.3.306');assert.match(r.engineVersion,/^\d+\.\d+\.\d+$/);
 assert.doesNotMatch(r.file,/claude-agent-sdk-win32/);assert.match(execFileSync(r.file,['--version'],{encoding:'utf8',windowsHide:true}),new RegExp(r.engineVersion.replaceAll('.','\\.')));
});

test('SDK adapter keeps settings, pauses for approvals/questions, resumes, and interrupts',{skip:process.platform!=='win32'},async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-sdk-'));
 fs.mkdirSync(path.join(workspace,'.claude'));const settings='{"model":"company-default"}';fs.writeFileSync(path.join(workspace,'.claude/settings.json'),settings);
 const calls=[],decisions=[];
 const claudeQuery=({prompt,options})=>{
  calls.push(options);
  const gen=(async function*(){
   yield {type:'system',subtype:'init',session_id:'session-one',model:'company-model-id',permissionMode:'default'};
   const result=await options.canUseTool('Write',{file_path:'result.txt',content:'approved only'},{signal:options.abortController.signal});decisions.push(result);
   if(options.abortController.signal.aborted)return;
   if(prompt==='question')decisions.push(await options.canUseTool('AskUserQuestion',{questions:[{question:'Choose outputs',header:'Output',multiSelect:true,options:[{label:'PNG'},{label:'HTML'}]}]},{signal:options.abortController.signal}));
   if(options.abortController.signal.aborted)return;
   yield {type:'stream_event',event:{type:'message_start',message:{id:'a'}}};
   yield {type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'partial'}}};
   yield {type:'assistant',message:{id:'a',content:[{type:'text',text:'complete'}]}};
   yield {type:'result',is_error:false};
  })();gen.close=()=>{};return gen;
 };
 const app=new Interaction({workspace,env:process.env,claudeQuery});
 t.after(async()=>{await app.close();fs.rmSync(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const {id}=await app.send({text:'question'});await until(()=>app.requests.size===1);
 let request=[...app.requests.values()][0];assert.equal(request.params.chatId,id);assert.equal(app.chats[0].busy,true);assert.equal(decisions.length,0);
 assert.throws(()=>app.answer({id:request.id}),/승인/);app.answer({id:request.id,decision:'accept'});assert.throws(()=>app.answer({id:request.id,decision:'accept'}),/만료/);
 await until(()=>[...app.requests.values()][0]?.method==='claude/requestUserInput');request=[...app.requests.values()][0];
 assert.throws(()=>app.answer({id:request.id,answers:{}}),/질문/);app.answer({id:request.id,answers:{'0':['PNG','HTML']}});
 await until(()=>!app.chats[0].busy);assert.equal(app.chats[0].status,'completed');assert.equal(app.chats[0].items.filter(i=>i.type==='agentMessage').length,1);assert.equal(decisions[1].updatedInput.answers['Choose outputs'],'PNG, HTML');
 assert.deepEqual(app.chats[0].runtimeOptions,{model:'company-model-id',permissionMode:'default'});
 const opts=calls[0];assert.equal(opts.cwd,workspace);assert.deepEqual(opts.settingSources,['user','project','local']);for(const key of ['model','permissionMode','settings','allowDangerouslySkipPermissions'])assert.equal(opts[key],undefined);
 assert.equal(fs.readFileSync(path.join(workspace,'.claude/settings.json'),'utf8'),settings);
 await app.send({chatId:id,text:'deny'});await until(()=>app.requests.size===1);assert.equal(calls[1].resume,'session-one');app.answer({id:[...app.requests.keys()][0],decision:'decline'});await until(()=>!app.chats[0].busy);assert.equal(decisions.at(-1).behavior,'deny');
 await app.send({chatId:id,text:'stop'});await until(()=>app.requests.size===1);await app.interrupt(id);assert.equal(app.requests.size,0);assert.equal(app.chats[0].status,'interrupted');assert.equal(app.chats[0].busy,false);
 await app.send({chatId:id,text:'close'});await until(()=>app.requests.size===1);await app.close();assert.equal(app.requests.size,0);assert.equal(app.chats[0].busy,false);
});

test('question cancellation and abort remove pending resolvers',async()=>{
 const requests=new Map(),broker=new ClaudePrompts(requests),signal=new AbortController();
 const promise=broker.ask({id:'chat'},'AskUserQuestion',{questions:[{question:'Which?',multiSelect:false}]},{signal:signal.signal});
 const id=[...requests.keys()][0];assert.throws(()=>broker.answer({id,answers:{'0':['one','two']}}),/한 개/);signal.abort();assert.equal((await promise).behavior,'deny');assert.equal(requests.size,0);assert.equal(broker.pending.size,0);
 const next=broker.ask({id:'chat'},'AskUserQuestion',{questions:[{question:'Which?'}]});broker.answer({id:[...requests.keys()][0],decision:'cancel'});assert.equal((await next).interrupt,true);
});


test('chat options are validated, persisted, inherited, cleared, and forwarded to SDK',{skip:process.platform!=='win32'},async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-sdk-options-')),calls=[];
 const claudeQuery=({options})=>{calls.push(options);return (async function*(){yield {type:'result',is_error:false,session_id:'options-session'};})();};
 const app=new Interaction({workspace,env:process.env,claudeQuery});t.after(async()=>{await app.close();fs.rmSync(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await assert.rejects(()=>app.send({text:'bad',claudeOptions:{effort:'ultra'}}));assert.equal(app.chats.length,0);
 const {id}=await app.send({text:'plan',claudeOptions:{model:'company-model',effort:'high',permissionMode:'plan'}});await until(()=>!app.chats[0].busy);
 assert.equal(calls[0].model,'company-model');assert.equal(calls[0].effort,'high');assert.equal(calls[0].permissionMode,'plan');assert.equal(calls[0].allowDangerouslySkipPermissions,undefined);
 await app.send({chatId:id,text:'continue'});await until(()=>!app.chats[0].busy);assert.equal(calls[1].effort,'high');assert.equal(calls[1].resume,'options-session');
 await app.flushSaves();
 const saved=JSON.parse(fs.readFileSync(path.join(workspace,'.isp/interaction.json'),'utf8'));assert.equal(saved.chats[0].claudeOptions.permissionMode,'plan');
 await app.send({chatId:id,text:'reset',claudeOptions:{}});await until(()=>!app.chats[0].busy);assert.equal(calls[2].model,undefined);assert.equal(calls[2].effort,undefined);assert.equal(calls[2].permissionMode,undefined);
});
