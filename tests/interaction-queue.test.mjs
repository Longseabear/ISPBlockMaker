import {initialProject} from '../server/model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {InteractionQueue} from '../server/interaction-queue.mjs';
import {Interaction} from '../server/interaction.mjs';
function fixture(t){
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'isp-queue-'));
 const sent=[];
 const m={workspace,chats:[],async save(){},async sendNow(v){sent.push(v);this.chats.find(c=>c.id===v.chatId).busy=true;},async interrupt(id){this.chats.find(c=>c.id===id).busy=false;}};
 const queue=new InteractionQueue(m);t.after(()=>{queue.stop();fs.rmSync(workspace,{recursive:true,force:true});});return {m,queue,sent,workspace};
}
test('pending instructions remain FIFO, editable, removable and idempotent without a browser',async t=>{
 const {m,queue,sent}=fixture(t);const a=await queue.submit({text:'A'});
 const requestId=crypto.randomUUID();const b=await queue.submit({chatId:a.id,text:'B',requestId});
 await queue.submit({chatId:a.id,text:'B',requestId});
 const c=await queue.submit({chatId:a.id,text:'C'});
 const d=await queue.submit({chatId:a.id,text:'D'});
 assert.deepEqual(m.chats[0].queue.map(q=>q.text),['B','C','D']);
 await queue.edit(a.id,{id:b.queueId,text:'B edited'});await queue.edit(a.id,{id:d.queueId,remove:true});
 m.chats[0].busy=false;await queue.drain();m.chats[0].busy=false;await queue.drain();
 assert.deepEqual(sent.map(v=>v.text),['A','B edited','C']);assert.equal(m.chats[0].queue.length,0);
 assert.equal((await queue.submit({chatId:a.id,text:'B',requestId})).duplicate,true);
});
test('stop-and-send prioritizes the new instruction and retains the old queue',async t=>{
 const {m,queue,sent}=fixture(t);const a=await queue.submit({text:'A'});await queue.submit({chatId:a.id,text:'B'});
 await queue.submit({chatId:a.id,text:'urgent',stopFirst:true});
 assert.deepEqual(sent.map(v=>v.text),['A','urgent']);assert.deepEqual(m.chats[0].queue.map(q=>q.text),['B']);
});
test('failed dispatch pauses and retains pending instructions until resume',async t=>{
 const {m,queue,sent}=fixture(t);const send=m.sendNow;m.sendNow=async()=>{throw Error('offline');};
 const a=await queue.submit({text:'A'});assert.equal(m.chats[0].queuePaused,true);assert.equal(m.chats[0].queue.length,1);
 m.sendNow=send;await queue.drain();assert.equal(sent.length,0);
 await queue.edit(a.id,{resume:true});await queue.drain();assert.equal(sent[0].text,'A');
});
test('conflicting files serialize; known independent block files can run concurrently',async t=>{
 const {m,queue,sent,workspace}=fixture(t);fs.mkdirSync(path.join(workspace,'project'));
 fs.writeFileSync(path.join(workspace,'project/graph.json'),JSON.stringify({...initialProject,edges:[],blocks:[['a','same.py'],['b','./SAME.py'],['c','other.py']].map(([id,implementation])=>({...initialProject.blocks[0],id,implementation}))}));
 await queue.submit({text:'A',blockId:'a'});await queue.submit({text:'B',blockId:'b'});await queue.submit({text:'C',blockId:'c'});
 assert.deepEqual(sent.map(v=>v.text),['A','C']);assert.equal(m.chats[1].queue.length,1);
 m.chats[0].busy=false;await queue.drain();assert.deepEqual(sent.map(v=>v.text),['A','C','B']);
});
test('server restart preserves pending instructions but requires explicit resume',async t=>{
 const {workspace}=fixture(t);fs.mkdirSync(path.join(workspace,'.isp'));const id=crypto.randomUUID();
 fs.writeFileSync(path.join(workspace,'.isp/interaction.json'),JSON.stringify({chats:[{id,provider:'claude',items:[],busy:true,queue:[{id:crypto.randomUUID(),text:'B',state:'dispatching'}]}]}));
 const app=new Interaction({workspace,env:process.env});t.after(()=>app.close());
 assert.equal(app.chats[0].queuePaused,true);assert.equal(app.chats[0].queue[0].text,'B');assert.match(app.chats[0].queueReason,/불확실/);
 await app.queue.drain();assert.equal(app.chats[0].busy,false);
});
test('storage failure prevents execution and preserves the request for recovery',async t=>{
 const {m,queue,sent}=fixture(t);m.save=async()=>{throw Error('disk full');};
 await assert.rejects(queue.submit({text:'A'}),/disk full/);assert.equal(sent.length,0);assert.equal(m.chats[0].queue[0].text,'A');
});
