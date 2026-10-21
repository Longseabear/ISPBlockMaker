import {readGraph,readGraphAt} from './graph-storage.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {claudeOptionsSchema} from './claude-options.mjs';
const inputSchema=z.object({diagramId:z.string().max(80).optional(),harnessRunId:z.string().uuid().optional(),stopFirst:z.boolean().optional(),requestId:z.string().uuid().optional(),chatId:z.string().uuid().optional(),text:z.string().trim().min(1).max(30000),blockId:z.string().max(100).default(''),provider:z.enum(['codex','claude']).default('claude'),model:z.string().max(100).optional(),claudeOptions:claudeOptionsSchema.optional()});
export class InteractionQueue {
 constructor(manager){this.manager=manager;this.running=false;this.timer=null;this.stopped=false;}
 conflict(chat){
  let blocks=[];try{blocks=readGraph(path.join(this.manager.workspace,'project','graph.json')).blocks||[];}catch{}
  const source=id=>{const value=blocks.find(b=>b.id===id)?.implementation;return typeof value==='string'&&value?path.resolve(this.manager.workspace,'project',value).toLowerCase():null;};
  return this.manager.chats.find(other=>other.id!==chat.id&&other.busy&&(!chat.blockId||!other.blockId||chat.blockId===other.blockId||!source(chat.blockId)||!source(other.blockId)||source(chat.blockId)===source(other.blockId)));
 }
 async submit(raw){
  if(this.stopped)throw Error('서버 종료 중입니다. 다시 연결하세요.');
  const input=inputSchema.parse(raw),m=this.manager;
  if(input.requestId){const owner=m.chats.find(c=>(c.submissions||[]).includes(input.requestId)||(c.queue||[]).some(q=>q.id===input.requestId));if(owner)return {id:owner.id,duplicate:true};}
  let chat=input.chatId?m.chats.find(c=>c.id===input.chatId):null;
  if(input.chatId&&!chat)throw Error('이 작업 폴더의 대화가 아닙니다.');
  if(!chat){if(m.chats.length>=50)throw Error('대화는 최대 50개입니다.');chat={id:crypto.randomUUID(),provider:input.provider,diagramId:input.diagramId,harnessRunId:input.harnessRunId,title:input.text.slice(0,60),blockId:input.blockId,items:[],busy:false,status:'idle',createdAt:new Date().toISOString()};m.chats.push(chat);}
  if((chat.queue||[]).length>=100)throw Error('대기 지시는 대화당 최대 100개입니다.');
  if(!chat.busy && !chat.queue?.length)chat.queuePaused=false;
  if(input.stopFirst){await m.interrupt(chat.id);for(let n=0;chat.busy&&n<100;n++)await new Promise(r=>setTimeout(r,50));if(chat.busy)throw Error('중지 확인을 기다리는 중입니다. 잠시 후 다시 보내세요.');chat.queuePaused=false;}
  const id=input.requestId||crypto.randomUUID();
  const item={id,text:input.text,model:input.model,claudeOptions:input.claudeOptions,createdAt:new Date().toISOString(),state:'queued'};
  (chat.queue||=[])[input.stopFirst?'unshift':'push'](item);
  chat.queueReason=chat.queuePaused?'중지됨':chat.busy?'현재 작업 완료 후 실행':this.conflict(chat)?'겹치는 작업 완료 후 실행':'';
  await m.save(true);this.kick();await this.drain();return {id:chat.id,queued:true,queueId:id};
 }
 kick(){if(this.stopped||this.timer)return;this.timer=setTimeout(()=>{this.timer=null;void this.drain().catch(e=>{this.manager.error='대기 지시 처리 실패: '+e.message;});},25);}
 async drain(){
  if(this.running||this.stopped)return;this.running=true;
  try{for(const chat of this.manager.chats){
   if(this.stopped)break;
   if(chat.busy||chat.queuePaused||!chat.queue?.length)continue;
   if(this.conflict(chat)){chat.queueReason='겹치는 작업 완료 후 실행';continue;}
   const item=chat.queue[0];item.state='dispatching';chat.queueReason='';
   try{await this.manager.save(true);if(this.stopped){item.state='queued';break;}await this.manager.sendNow({chatId:chat.id,provider:chat.provider||'codex',blockId:chat.blockId,text:item.text,model:item.model,claudeOptions:item.claudeOptions});
    chat.queue=chat.queue.filter(q=>q.id!==item.id);(chat.submissions||=[]).push(item.id);
   }catch(e){item.state='queued';chat.queuePaused=true;chat.queueReason=String(e.message);chat.error=String(e.message);}
   await this.manager.save();
  }}finally{this.running=false;}
 }
 async edit(chatId,{id,text,remove,resume}){
  const chat=this.manager.chats.find(c=>c.id===chatId);if(!chat)throw Error('대화를 찾을 수 없습니다.');
  if(resume){chat.queuePaused=false;chat.queueReason='';}
  else{const item=chat.queue?.find(q=>q.id===id);if(!item)throw Error('이미 실행되었거나 삭제된 지시입니다.');if(item.state==='dispatching')throw Error('실행을 시작한 지시는 수정할 수 없습니다.');if(remove)chat.queue=chat.queue.filter(q=>q.id!==id);else item.text=z.string().trim().min(1).max(30000).parse(text);}
  await this.manager.save();this.kick();return {ok:true};
 }
 stop(){this.stopped=true;clearTimeout(this.timer);}
}
