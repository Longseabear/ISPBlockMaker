import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {recoverImageSession} from '../server/claude-image-recovery.mjs';import {runClaude} from '../server/claude-interaction.mjs';
test('recovery preserves UI history but never resumes poisoned session or replays image results',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-image-recovery-'));t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}));
 const items=[{id:'u',type:'userMessage',text:'Plot SNR with Python'},{id:'tool',type:'claudeToolCall',result:[{type:'image',source:{data:'DO_NOT_REPLAY'}}]}];
 const chat={id:'chat',provider:'claude',threadId:'poisoned-session',busy:false,error:'API Error: 400 this model does not support image input',items};recoverImageSession(chat);
 assert.equal(chat.items,items);assert.equal(chat.threadId,null);assert.deepEqual(chat.previousSessionIds,['poisoned-session']);
 let captured,decision;
 const run=runClaude({workspace,env:{},chat,text:'continue',runtime:{file:'unused'},save:()=>{},cancelPrompts:()=>{},ask:()=>{throw Error('Image read must be intercepted');},queryImpl:args=>{captured=args;return(async function*(){decision=await args.options.canUseTool('Read',{file_path:'plot.png'},{});yield {type:'result',is_error:false,session_id:'new-session'};})();}});
 await run.done;assert.equal(captured.options.resume,undefined);assert.match(captured.prompt,/Plot SNR/);assert.doesNotMatch(captured.prompt,/DO_NOT_REPLAY/);assert.equal(decision.behavior,'deny');assert.equal(chat.threadId,'new-session');assert.equal(chat.status,'completed');
});
test('recovery refuses active runs and unrelated errors',()=>{
 assert.throws(()=>recoverImageSession({busy:true}),/중지/);
 assert.throws(()=>recoverImageSession({provider:'claude',error:'401 unauthorized'}),/이미지 입력 오류/);
});
