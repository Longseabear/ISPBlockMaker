import {claudeDeclaredSettings} from '../server/claude-declared-settings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {mergeInteraction} from '../src/interaction-state.ts';
import {AsyncSnapshot} from '../server/async-snapshot.mjs';
test('large replay merges once, maintains ordering, and preserves unchanged references',()=>{
 const items=Array.from({length:20000},(_,i)=>({id:String(i),text:'Message '+i}));
 const updates=items.map(item=>({chatId:'a',item}));const start=performance.now();
 const initial=mergeInteraction({chats:[]},{state:{chats:[{id:'a',items:[]},{id:'b',items:[]}]},updates},true);
 assert.equal(initial.chats[0].items.length,20000);assert.ok(performance.now()-start<1500,'Replay must not use quadratic array copying');
 const changed={id:'19999',text:'partial response'};
 const next=mergeInteraction(initial,{updates:[{chatId:'a',item:changed}]});
 assert.equal(next.chats[0].items[0],items[0]);assert.equal(next.chats[0].items.at(-1),changed);assert.equal(next.chats[1],initial.chats[1]);assert.equal(initial.chats[0].items.at(-1).text,'Message 19999');
 const reset=mergeInteraction(next,{state:{chats:[{id:'b',items:[]}]},updates:[]},true);assert.equal(reset.chats.length,1);assert.equal(reset.chats[0].items.length,0);
});
test('snapshot writer coalesces requests and flushes the latest state in order',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-async-save-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'state.json'),writer=new AsyncSnapshot(file);let state={revision:0,payload:'x'.repeat(1024*1024)};
 const first=writer.write(()=>state);for(let i=1;i<=100;i++){state={...state,revision:i};writer.write(()=>state);}
 await first;await writer.flush();assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).revision,100);
 state={revision:101,payload:'latest'};await writer.write(()=>state);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).revision,101);assert.deepEqual(fs.readdirSync(dir),['state.json']);
});

test('settings display includes model declarations without credentials',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-declared-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const config=path.join(dir,'user');fs.mkdirSync(config);fs.mkdirSync(path.join(dir,'.claude'));
 fs.writeFileSync(path.join(config,'settings.json'),JSON.stringify({model:'company-user',env:{ANTHROPIC_AUTH_TOKEN:'must-not-leak'}}));
 fs.writeFileSync(path.join(dir,'.claude','settings.local.json'),JSON.stringify({model:'company-local',permissions:{defaultMode:'plan'},effortLevel:'high'}));
 const entries=await claudeDeclaredSettings(dir,{CLAUDE_CONFIG_DIR:config});assert.equal(entries[0].model,'company-user');assert.equal(entries[1].model,'company-local');assert.equal(entries[1].permissionMode,'plan');assert.doesNotMatch(JSON.stringify(entries),/must-not-leak|AUTH_TOKEN/);
});
