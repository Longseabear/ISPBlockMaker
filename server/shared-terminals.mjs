import crypto from 'node:crypto';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as pty from 'node-pty';
import {z} from 'zod';

const uuid=z.string().uuid();
const createSchema=z.object({id:uuid,title:z.string().trim().min(1).max(100),owner:z.enum(['agent','user']).default('agent')}).strict();
const writeSchema=z.object({requestId:uuid,data:z.string().min(1).max(16000),actor:z.enum(['agent','user']).optional(),controlVersion:z.number().int().min(0).optional()}).strict();
const user={kind:'user'};
export const TERMINAL_LIMITS={sessions:16,perAgent:4,outputChars:200000,inputBytesPerSecond:65536,agentRequests:4096,subscribers:4,minimumFreeMemoryBytes:256*1024*1024};
const send=(socket,value)=>{if(socket.readyState!==1)return;if(socket.bufferedAmount>2*1024*1024){socket.close(1013,'Terminal client too slow');return;}socket.send(JSON.stringify(value));};

export class SharedTerminals {
 constructor({context,agents,freeMemory=os.freemem,notify=()=>{},spawn=pty.spawn,kill=async process=>{
  if(globalThis.process.platform==='win32'){
   try{await promisify(execFile)('taskkill.exe',['/PID',String(process.pid),'/T','/F'],{windowsHide:true,timeout:5000});return;}catch{}
  }
  process.kill();
 }}){this.context=context;this.agents=agents;this.freeMemory=freeMemory;this.notify=notify;this.spawn=spawn;this.kill=kill;this.sessions=new Map();}
 info(s){return {id:s.id,title:s.title,owner:s.owner,agentId:s.agentId,agent:s.agentId?this.agents?.get(s.agentId):null,controlVersion:s.controlVersion,status:s.status,pid:s.process.pid,createdAt:s.createdAt,exitCode:s.exitCode,cursor:s.end,userInputSequence:s.userInputSequence,bufferChars:s.buffer.length};}
 list(){return [...this.sessions.values()].map(s=>this.info(s));}
 changed(){this.notify({type:'shared-terminals',sessions:this.list(),agents:this.agents?.list()||[],resources:this.resources()});}
 resources(){return {limits:TERMINAL_LIMITS,sessions:this.sessions.size,running:[...this.sessions.values()].filter(s=>s.status!=='exited').length,bufferChars:[...this.sessions.values()].reduce((n,s)=>n+s.buffer.length,0),agentRequestIds:[...this.sessions.values()].reduce((n,s)=>n+s.writes.size,0),serverRssBytes:process.memoryUsage().rss,systemFreeBytes:this.freeMemory(),systemTotalBytes:os.totalmem(),processMemoryLimited:false};}
 check(s,caller,version){if(caller.kind==='user')return;if(s.agentId!==caller.id||s.owner!=='agent')throw Error('이 터미널의 입력 소유자가 아닙니다. 명시적인 인계를 기다리세요.');if(version!==s.controlVersion)throw Error('제어권이 변경되었습니다. 상태를 다시 읽고 새 요청으로 보내세요.');}
 get(id){const s=this.sessions.get(uuid.parse(id));if(!s)throw Error('Terminal Hub을 찾을 수 없습니다.');return s;}
 create(raw,caller=user){
  if(this.closing)throw Error('Terminal Hub 종료 중입니다. 잠시 후 다시 시도하세요.');
  const input=createSchema.parse(raw),existing=this.sessions.get(input.id);
  if(existing){if(existing.title!==input.title||existing.createdBy!==(caller.id||'user'))throw Error('Session ID already used');return this.info(existing);}
  if(this.sessions.size>=TERMINAL_LIMITS.sessions)throw Error('Terminal Hub은 최대 16개입니다. 종료된 세션을 삭제하세요.');
  if(caller.kind==='agent'&&[...this.sessions.values()].filter(s=>s.agentId===caller.id).length>=TERMINAL_LIMITS.perAgent)throw Error('에이전트별 터미널 한도는 4개입니다. 종료된 세션을 삭제하거나 인계하세요.');
  if(this.freeMemory()<TERMINAL_LIMITS.minimumFreeMemoryBytes)throw Error('시스템 여유 메모리가 256 MiB 미만입니다. 새 세션을 만들기 전에 실행 중인 작업을 정리하세요.');
  const {workspace,env}=this.context(),windows=process.platform==='win32';
  const processPty=this.spawn(windows?'cmd.exe':env.SHELL||'/bin/bash',windows?['/d','/q']:['-i'],{name:'xterm-256color',cols:100,rows:28,cwd:workspace,env:{...env,TERM:'xterm-256color'}});
  const s={...input,owner:caller.kind,agentId:caller.id||null,createdBy:caller.id||'user',controlVersion:0,process:processPty,status:'running',createdAt:new Date().toISOString(),buffer:'',end:0,userInputSequence:0,sockets:new Set(),writes:new Map(),inputWindow:0,inputBytes:0};
  this.sessions.set(s.id,s);
  processPty.onData(data=>{s.buffer=(s.buffer+data).slice(-TERMINAL_LIMITS.outputChars);s.end+=data.length;for(const socket of s.sockets){const pending=socket.sharedPending||0;if(pending+data.length>262144){socket.close(1013,'Terminal renderer too slow');s.sockets.delete(socket);continue;}socket.sharedPending=pending+data.length;send(socket,{type:'shared-output',id:s.id,data});}});
  processPty.onExit(({exitCode})=>{s.status='exited';s.exitCode=exitCode;for(const socket of s.sockets)send(socket,{type:'shared-exit',id:s.id,exitCode});this.changed();});
  this.changed();return this.info(s);
 }
 read(id,{cursor=0,limit=12000}={}){
  cursor=z.coerce.number().int().min(0).parse(cursor);limit=z.coerce.number().int().min(1).max(24000).parse(limit);
  const s=this.get(id);if(cursor>s.end)throw Error('Output cursor is ahead of this session');
  const base=s.end-s.buffer.length,start=Math.max(base,cursor),end=Math.min(s.end,start+limit);
  return {...this.info(s),output:s.buffer.slice(start-base,end-base),cursor:end,truncated:cursor<base,hasMore:end<s.end};
 }
 write(id,raw,caller=user){
  const s=this.get(id),input=writeSchema.parse(raw),hash=crypto.createHash('sha256').update((caller.id||'user')+'\0'+input.controlVersion+'\0'+input.data).digest('hex');
  this.check(s,caller,input.controlVersion);
  if(input.controlVersion!==s.controlVersion)throw Error('제어권이 변경되었습니다. 상태를 다시 읽으세요.');
  if(s.writes.has(input.requestId)){if(s.writes.get(input.requestId)!==hash)throw Error('Input request ID already used');return {...this.info(s),duplicate:true};}
  if(s.status!=='running')throw Error('터미널이 실행 중이 아닙니다.');
  if(s.owner!==caller.kind)throw Error('직접 조작을 선택한 뒤 입력하세요.');
  // Keep IDs for the lifetime of the session: a lost response must not execute input twice.
  if(caller.kind==='agent'&&s.writes.size>=TERMINAL_LIMITS.agentRequests)throw Error('입력 기록 한도입니다. 새 Terminal Hub을 만드세요.');
  const now=Date.now();if(now-s.inputWindow>=1000){s.inputWindow=now;s.inputBytes=0;}const bytes=Buffer.byteLength(input.data);if(s.inputBytes+bytes>TERMINAL_LIMITS.inputBytesPerSecond)throw Error('터미널 입력 속도 한도입니다. 잠시 후 다시 보내세요.');s.inputBytes+=bytes;
  s.process.write(input.data);if(caller.kind==='agent')s.writes.set(input.requestId,hash);
  if(caller.kind==='user')s.userInputSequence++;
  return this.info(s);
 }
 control(id,owner,agentId,caller=user,version){const s=this.get(id);this.check(s,caller,version);owner=z.enum(['agent','user']).parse(owner);const target=agentId||s.agentId;if(owner==='agent'){if(!target||this.agents?.get(target).status==='disconnected')throw Error('연결된 에이전트를 선택하세요.');if(target!==s.agentId&&[...this.sessions.values()].filter(v=>v.agentId===target).length>=TERMINAL_LIMITS.perAgent)throw Error('받는 에이전트의 터미널 한도는 4개입니다.');s.agentId=target;}s.owner=owner;s.controlVersion++;this.changed();return this.info(s);}
 attach(socket,id){this.detach(socket);const s=this.get(id);if(s.sockets.size>=TERMINAL_LIMITS.subscribers)throw Error('세션당 화면 연결은 최대 4개입니다.');s.sockets.add(socket);socket.sharedId=s.id;socket.sharedPending=s.buffer.length;send(socket,{type:'shared-attached',session:this.info(s),buffer:s.buffer});}
 acknowledge(socket,chars){socket.sharedPending=Math.max(0,(socket.sharedPending||0)-z.number().int().min(0).max(262144).parse(chars));}
 detach(socket){this.sessions.get(socket.sharedId)?.sockets.delete(socket);socket.sharedId=null;}
 resize(id,cols,rows){const s=this.get(id);if(s.status==='running')s.process.resize(z.number().int().min(2).max(500).parse(cols),z.number().int().min(2).max(300).parse(rows));}
 present(id,raw,caller=user){const s=this.get(id),input=z.object({reason:z.enum(['input','error','inspect','user']),message:z.string().trim().min(1).max(300)}).strict().parse(raw);if(caller.kind==='agent'&&s.agentId!==caller.id)throw Error('자신의 터미널만 표시할 수 있습니다.');if(caller.kind==='agent'&&Date.now()-(s.presentedAt||0)<30000)return {requested:false,reason:'cooldown',id:s.id};s.presentedAt=Date.now();this.notify({type:'shared-present',id:s.id,...input});return {requested:true,id:s.id};}
 async stop(id,caller=user,version){const s=this.get(id);this.check(s,caller,version);if(s.stopPromise)return s.stopPromise;if(s.status!=='running')return this.info(s);s.status='stopping';this.changed();s.stopPromise=(async()=>{try{await this.kill(s.process);}catch(e){if(s.status!=='exited'){s.status='running';this.changed();throw e;}}return this.info(s);})().finally(()=>{s.stopPromise=null;});return s.stopPromise;}
 remove(id,caller=user,version){const s=this.get(id);this.check(s,caller,version);if(s.status!=='exited')throw Error('먼저 세션을 종료하세요.');for(const socket of s.sockets){send(socket,{type:'shared-removed',id:s.id});socket.sharedId=null;}this.sessions.delete(s.id);this.changed();return {ok:true};}
 close(){if(this.closing)return this.closing;this.closing=(async()=>{await Promise.all([...this.sessions.keys()].map(id=>this.stop(id)));for(const s of this.sessions.values())for(const socket of s.sockets)socket.sharedId=null;this.sessions.clear();this.changed();})().finally(()=>{this.closing=null;});return this.closing;}
}

export function installSharedTerminals(app,manager){
 app.get('/api/shared-terminals/agents',(_req,res)=>res.json(manager.agents?.list()||[]));
 app.get('/api/shared-terminals/resources',(_req,res)=>res.json(manager.resources()));
 app.get('/api/shared-terminals',(_req,res)=>res.json(manager.list()));
 app.post('/api/shared-terminals',(req,res)=>res.json(manager.create(req.body,req.mcpActor)));
 app.get('/api/shared-terminals/:id/output',(req,res)=>res.json(manager.read(req.params.id,req.query)));
 app.post('/api/shared-terminals/:id/input',(req,res)=>res.json(manager.write(req.params.id,req.body,req.mcpActor)));
 app.post('/api/shared-terminals/:id/control',(req,res)=>res.json(manager.control(req.params.id,req.body.owner,req.body.agentId,req.mcpActor,req.body.controlVersion)));
 app.post('/api/shared-terminals/:id/present',(req,res)=>res.json(manager.present(req.params.id,req.body,req.mcpActor)));
 app.post('/api/shared-terminals/:id/stop',async(req,res)=>res.json(await manager.stop(req.params.id,req.mcpActor,req.body.controlVersion)));
 app.delete('/api/shared-terminals/:id',(req,res)=>res.json(manager.remove(req.params.id,req.mcpActor,Number(req.query.controlVersion))));
}
