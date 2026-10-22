import {InteractionQueue} from './interaction-queue.mjs';
import {recoverImageSession} from './claude-image-recovery.mjs';
import {claudeDeclaredSettings} from './claude-declared-settings.mjs';
import {AsyncSnapshot} from './async-snapshot.mjs';
import {claudeOptionsSchema} from './claude-options.mjs';
import {ClaudePrompts} from './claude-prompts.mjs';
import {readChatImage} from './chat-images.mjs';
import {readChatFile} from './chat-files.mjs';
import {runClaude,claudeRuntimeAsync} from './claude-interaction.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import {z} from 'zod';
import {resolveAgent,prepareMcpLaunch} from './mcp-settings.mjs';

class RequestMap extends Map {set(k,v){super.set(k,v);this.changed?.();return this;}delete(k){const result=super.delete(k);this.changed?.();return result;}}
const bounded=value=>String(value??'').slice(-100000);
export class Interaction {
 constructor({workspace,env,launch,claudeQuery}){
  this.claudeQuery=claudeQuery;this.claudeRuns=new Map();this.workspace=workspace;this.env=env;this.launch=launch;this.pending=new Map();this.requests=new RequestMap();this.listeners=new Set();this.requests.changed=()=>this.changed();this.claudePrompts=new ClaudePrompts(this.requests);this.seq=0;this.child=null;this.ready=null;this.account=null;this.models=[];this.error='';this.chats=[];this.closed=false;
  this.queue=new InteractionQueue(this);this.declaredSettings=[];void claudeDeclaredSettings(workspace,env).then(value=>{this.declaredSettings=value;this.changed();});
  const base=path.join(workspace,'.isp');fs.mkdirSync(base,{recursive:true});
  this.file=path.join(base,'interaction.json');this.persistence=new AsyncSnapshot(this.file);
  this.apiRuns={};this.apiEvents=[];this.apiSequence=0;this.apiSessions={};
  for(const f of [base,this.file])if(fs.existsSync(f)&&fs.lstatSync(f).isSymbolicLink())throw Error('Linked interaction state is not supported');
  if(fs.existsSync(this.file)){const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));this.chats=(saved.chats||[]).map(c=>({...c,loaded:false,busy:false,turnId:null,queuePaused:!!c.queue?.length||c.queuePaused,queueReason:c.queue?.some(q=>q.state==='dispatching')?'시작 여부가 불확실한 지시가 있습니다. 대화 기록을 확인하고 삭제 또는 재개하세요':c.queue?.length?'서버 재시작 후 재개를 눌러주세요':c.queueReason,queue:(c.queue||[]).map(q=>({...q,state:'queued'})),status:c.busy?'interrupted':c.status}));}
  if(fs.existsSync(this.file)){const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));this.apiRuns=saved.apiRuns||{};this.apiEvents=saved.apiEvents||[];this.apiSequence=saved.apiSequence||0;this.apiSessions=saved.apiSessions||{};
   for(const run of Object.values(this.apiRuns))if(!['completed','failed','cancelled','interrupted'].includes(run.status)){run.status='interrupted';run.error='Server restarted; inspect the previous work before submitting again.';this.apiEvent(run);}
   for(const c of this.chats){delete c.currentApiRun;c.queue=(c.queue||[]).filter(q=>!this.apiRuns[q.id]);}
  }
 }
 apiEvent(run){run.updated_at=new Date().toISOString();this.apiEvents.push({id:++this.apiSequence,type:'run.'+run.status,run_id:run.id,session_id:run.session_id,status:run.status,phase:run.phase||null,time:run.updated_at});if(this.apiEvents.length>1000)this.apiEvents.shift();}
 beginApiRun(chat,id){const run=this.apiRuns[id];if(!run)return;chat.currentApiRun=id;run.start_index=chat.items.length;run.status='dispatching';this.apiEvent(run);}
 syncApiRuns(){for(const c of this.chats){const run=this.apiRuns[c.currentApiRun];if(!run||['completed','failed','cancelled','interrupted'].includes(run.status))continue;
   const waiting=[...this.requests.values()].some(r=>r.params?.chatId===c.id||(c.threadId&&r.params?.threadId===c.threadId));
   let status=run.status;if(c.busy){run.started=true;status=waiting?'waiting_input':'running';}else if(run.started&&['completed','failed','interrupted'].includes(c.status))status=run.cancel_requested?'cancelled':c.status;
   const phase=c.busy?c.phase||c.status:null;
   if(status!==run.status||phase!==run.phase){run.status=status;run.phase=phase;if(['completed','failed','cancelled','interrupted'].includes(status)){run.output=c.items.slice(run.start_index||0).filter(i=>i.type==='agentMessage').map(i=>i.text||'').join('\n\n').slice(-100000);run.error=c.error||'';delete c.currentApiRun;}this.apiEvent(run);}
  }}
 changed(){
  if(this.closed)return;
  this.syncApiRuns();
  if(!this.notifyTimer)this.notifyTimer=setTimeout(()=>{this.notifyTimer=null;for(const fn of this.listeners)fn();},40);
  if(!this.checkpointTimer)this.checkpointTimer=setTimeout(()=>{this.checkpointTimer=null;try{this.save();}catch(e){this.error='대화 기록 저장 실패: '+e.message;}},1000);
 }
 subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 save(strict=false){if(this.closed)return;this.syncApiRuns();this.queue.kick();clearTimeout(this.checkpointTimer);this.checkpointTimer=null;
 if(!this.notifyTimer)this.notifyTimer=setTimeout(()=>{this.notifyTimer=null;for(const fn of this.listeners)fn();},40);return this.persistence.write(()=>({chats:this.chats,apiRuns:this.apiRuns,apiEvents:this.apiEvents,apiSequence:this.apiSequence,apiSessions:this.apiSessions})).catch(error=>{this.error='대화 기록 저장 실패: '+error.message;for(const fn of this.listeners)fn();if(strict)throw error;});}
 flushSaves(){return this.persistence.flush();}
 snapshot(){return {declaredSettings:this.declaredSettings,preferredProvider:'claude',claude:this.claude||null,connected:!!this.child&&!!this.account,account:this.account,models:this.models,error:this.error,mcp:this.mcp||null,chats:this.chats,requests:[...this.requests.values()]};}
 write(value){if(!this.child?.stdin.writable)throw Error('Codex 연결이 닫혔습니다. 다시 연결하세요.');this.child.stdin.write(JSON.stringify(value)+'\n');}
 rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++this.seq,timer=setTimeout(()=>{this.pending.delete(id);reject(Error(method+' 응답 시간이 초과되었습니다.'));},60000);this.pending.set(id,{resolve,reject,timer});try{this.write({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
 async connect(){
  if(this.ready)return this.ready;
  this.ready=this.start().catch(e=>{this.error=e.message;this.disconnect();throw e;});return this.ready;
 }
 async start(){
  this.closed=false;this.error='';
  const mcp=prepareMcpLaunch(this.workspace,'codex',crypto.randomUUID(),this.env);this.mcp={revision:mcp.revision,names:mcp.names};
  const launch=this.launch||mcp.launch||resolveAgent('codex',this.env);
  const child=spawn(launch.command,[...launch.args,'app-server','--listen','stdio://'],{cwd:this.workspace,env:this.env,windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
  child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{this.receive(JSON.parse(line));}catch(e){this.error=e.message;}});
  const failed=e=>{if(this.child!==child)return;this.error=e?.message||'Codex 연결이 종료되었습니다. 다시 연결하세요.';this.child=null;this.ready=null;this.account=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(this.error));}this.pending.clear();for(const [id,r] of this.requests)if(r.provider!=='claude')this.requests.delete(id);for(const c of this.chats.filter(c=>c.provider!=='claude'))if(c.busy){c.queuePaused=true;c.busy=false;c.status='interrupted';c.turnId=null;}this.save();};
  child.on('error',failed);child.on('exit',()=>failed());
  await this.rpc('initialize',{clientInfo:{name:'isp_block_maker',title:'ISP Block Maker',version:'0.1.23'},capabilities:{experimentalApi:true}});this.write({method:'initialized',params:{}});
  const account=await this.rpc('account/read',{refreshToken:false});this.account=account.account||{type:'signedOut'};
  const models=await this.rpc('model/list',{});this.models=(models.data||[]).map(m=>({id:m.id,model:m.model,name:m.displayName||m.model,isDefault:m.isDefault}));
  return this.snapshot();
 }
 receive(message){try{this.receiveEvent(message);}finally{this.changed();}}
 receiveEvent(message){
  if(message.id!==undefined&&!message.method){const p=this.pending.get(message.id);if(p){clearTimeout(p.timer);this.pending.delete(message.id);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}return;}
  const {method,params:p={}}=message;
  if(message.id!==undefined){
   if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput','tool/requestUserInput'].includes(method)){this.requests.set(String(message.id),{id:message.id,method,params:p});}
   else if(method==='item/permissions/requestApproval')this.write({id:message.id,result:{permissions:{},scope:'turn'}});
   else if(method==='mcpServer/elicitation/request')this.write({id:message.id,result:{action:'decline'}});
   else this.write({id:message.id,error:{code:-32601,message:'This client does not support '+method}});
   return;
  }
  if(method==='serverRequest/resolved'){this.requests.delete(String(p.requestId));return;}
  const c=this.chats.find(c=>c.threadId===p.threadId);if(!c)return;
  if(method==='turn/started'){c.turnId=p.turn.id;c.busy=true;c.status='inProgress';}
  if(method==='item/started'||method==='item/completed'){
   const item=p.item;if(item.type==='userMessage')return;
   const index=c.items.findIndex(x=>x.id===item.id),next={...item,status:method==='item/completed'?(item.status||'completed'):'inProgress'};
   if(next.aggregatedOutput)next.aggregatedOutput=bounded(next.aggregatedOutput);
   if(index<0)c.items.push(next);else c.items[index]={...c.items[index],...next};
  }
  if(method==='item/agentMessage/delta'||method==='item/commandExecution/outputDelta'){
   let item=c.items.find(x=>x.id===p.itemId);if(!item){item={id:p.itemId,type:method.includes('agentMessage')?'agentMessage':'commandExecution',text:'',status:'inProgress'};c.items.push(item);}
   const field=method.includes('agentMessage')?'text':'aggregatedOutput';c.items[c.items.indexOf(item)]={...item,[field]:bounded((item[field]||'')+p.delta)};
  }
  if(method==='turn/completed'){c.updatedAt=new Date().toISOString();if(p.turn.status!=='completed')c.queuePaused=true;c.busy=false;c.turnId=null;c.status=p.turn.status;c.error=p.turn.error?.message||'';for(const [id,r] of this.requests)if(r.params.threadId===c.threadId)this.requests.delete(id);this.save();}
  if(method==='error'){c.error=p.error?.message||'Codex 실행 오류';}
  if(method==='turn/plan/updated')c.plan=p.plan;
 }
 async send(input){return this.queue.submit(input);}
 async sendNow(input){
  if(this.closing)throw Error('서버 종료 중입니다.');
  const {chatId,text,blockId,model,provider,claudeOptions}=z.object({claudeOptions:claudeOptionsSchema.optional(),provider:z.enum(['codex','claude']).default('claude'),chatId:z.string().uuid().optional(),text:z.string().trim().min(1).max(30000),blockId:z.string().max(100).default(''),model:z.string().max(100).optional()}).parse(input);
  if((chatId?(this.chats.find(c=>c.id===chatId)?.provider||'codex'):provider)==='claude')return this.sendClaude({chatId,text,blockId,claudeOptions});
  await this.connect();if(this.closing)throw Error('서버 종료 중입니다.');if(this.account.type==='signedOut')throw Error('Codex 로그인이 필요합니다. 터미널에서 codex login 후 다시 연결하세요.');
  let c=chatId?this.chats.find(c=>c.id===chatId):null;if(chatId&&!c)throw Error('이 작업 폴더의 대화가 아닙니다.');
  if(c?.busy)throw Error('현재 응답을 중지하거나 완료될 때까지 기다려주세요.');
  if(c&&model!==undefined)c.model=model||(this.models.find(m=>m.isDefault)?.model||null);
  if(!c){if(this.chats.length>=50)throw Error('대화는 최대 50개입니다. 종료된 대화를 정리하세요.');c={id:crypto.randomUUID(),title:text.slice(0,60),blockId,model:model||null,threadId:null,items:[],status:'idle',createdAt:new Date().toISOString()};this.chats.push(c);}
  c.updatedAt=new Date().toISOString();c.busy=true;c.error='';c.status='starting';this.save();
  try{
   const params={cwd:this.workspace,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write',...(c.model?{model:c.model}:{}),developerInstructions:`You are working in the ISP Block Maker workspace ${this.workspace}. Read AGENTS.md and project skills. Use node .isp/tools/isp.mjs for graph/context/artifacts. Pinned diagram: ${c.diagramId||'none'}. When a diagram is pinned, always use isp project --diagram ID and explicit --diagram ID for that diagram, regardless of UI selection. Otherwise run isp project or graph-info to discover the current diagram. Capture its diagramId and use --diagram ID for subsequent graph edits in that task. JOBs are project-global. The pinned block for this conversation is ${c.blockId||'whole project'}; do not silently change targets when UI selection changes. GPU simulator and Reference I/O features have been retired. Use Image Viewer for source inspection and Visualizations for reports. Respond in the user's language. Never print local API credentials.`};
   if(!c.loaded){const r=await this.rpc(c.threadId?'thread/resume':'thread/start',{...params,...(c.threadId?{threadId:c.threadId}:{})});c.threadId=r.thread.id;c.loaded=true;}
   c.items.push({id:crypto.randomUUID(),type:'userMessage',text});
   const r=await this.rpc('turn/start',{threadId:c.threadId,input:[{type:'text',text,text_elements:[]}],...(c.model?{model:c.model}:{})});
   if(c.busy)c.turnId=r.turn.id;this.save();return {id:c.id};
  }catch(e){c.busy=false;c.status='failed';c.error=e.message;this.save();throw e;}
 }
 async sendClaude({chatId,text,blockId,claudeOptions}){
  let c=chatId?this.chats.find(c=>c.id===chatId):null;
  if(chatId&&(!c||c.provider!=='claude'))throw Error('Claude 대화를 찾을 수 없습니다.');
  if(c?.busy)throw Error('현재 응답을 중지하거나 완료될 때까지 기다려주세요.');
  if(!c){if(this.chats.length>=50)throw Error('대화는 최대 50개입니다.');c={id:crypto.randomUUID(),provider:'claude',title:text.slice(0,60),blockId,threadId:null,items:[],createdAt:new Date().toISOString()};this.chats.push(c);}
  if(claudeOptions!==undefined)c.claudeOptions=claudeOptions;
  c.updatedAt=new Date().toISOString();c.busy=true;c.error='';c.status='starting';c.phase='starting';c.items.push({id:crypto.randomUUID(),type:'userMessage',text});this.save();
  try{const runtime=await claudeRuntimeAsync(this.env);if(this.closed||!c.busy)return {id:c.id};this.claude={ready:true,sdkVersion:runtime.sdkVersion,engineVersion:runtime.engineVersion,validated:runtime.validated};c.status='inProgress';this.claudeRuns.set(c.id,runClaude({workspace:this.workspace,env:this.env,chat:c,text,runtime,queryImpl:this.claudeQuery,changed:()=>this.changed(),ask:(...args)=>this.claudePrompts.ask(...args),cancelPrompts:id=>this.claudePrompts.cancelChat(id),save:()=>{if(!c.busy)c.updatedAt=new Date().toISOString();if(!c.busy&&c.status!=='completed')c.queuePaused=true;if(!c.busy)this.claudeRuns.delete(c.id);return this.save();}}));return {id:c.id};}
  catch(e){c.busy=false;c.status='failed';c.error=e.message;this.save();throw e;}
 }
 async recoverImage(id){const c=this.chats.find(c=>c.id===id);if(!c)throw Error('대화를 찾을 수 없습니다.');recoverImageSession(c);await this.save();return {ok:true};}
 async interrupt(id){const queuedChat=this.chats.find(c=>c.id===id);if(queuedChat){queuedChat.queuePaused=true;await this.save();}if(this.claudeRuns.has(id)){await this.claudeRuns.get(id).stop();this.claudeRuns.delete(id);return {ok:true};}const c=this.chats.find(c=>c.id===id);if(!c)throw Error('대화를 찾을 수 없습니다.');if(c.provider==='claude'&&c.status==='starting'){c.busy=false;c.status='interrupted';this.save();return {ok:true};}if(c.turnId)await this.rpc('turn/interrupt',{threadId:c.threadId,turnId:c.turnId});else if(c.busy)throw Error('연결 중입니다. 잠시 후 중지해주세요.');return {ok:true};}
 answer(input){const {id,decision,answers}=z.object({id:z.union([z.string(),z.number()]),decision:z.enum(['accept','decline','cancel']).optional(),answers:z.record(z.string(),z.array(z.string().max(10000))).optional()}).parse(input);const r=this.requests.get(String(id));if(!r)throw Error('이미 처리되었거나 만료된 요청입니다.');let result;
  if(r.provider==='claude'){this.claudePrompts.answer({id,decision,answers});return {ok:true};}
  if(r.method.endsWith('requestUserInput')){if(!answers)throw Error('답변을 입력하세요.');result={answers:Object.fromEntries((r.params.questions||[]).map(q=>[q.id,{answers:answers[q.id]||[]}]))};}
  else {if(!decision)throw Error('승인 또는 거절을 선택하세요.');const allowed=r.params.availableDecisions;if(allowed&&!allowed.includes(decision))throw Error('허용되지 않은 승인 선택입니다.');result={decision};}
  this.write({id:r.id,result});this.requests.delete(String(id));return {ok:true};
 }
 rename(id,title){const c=this.chats.find(c=>c.id===id);if(!c)throw Error('대화를 찾을 수 없습니다.');c.title=z.string().trim().min(1).max(100).parse(title);this.save();return {id:c.id,title:c.title};}
 remove(id){const c=this.chats.find(c=>c.id===id);if(c?.busy)throw Error('실행 중인 대화는 삭제할 수 없습니다.');for(const run of Object.values(this.apiRuns))if(run.session_id===id&&['queued','dispatching'].includes(run.status)){run.status='cancelled';run.error='Session deleted';this.apiEvent(run);}this.chats=this.chats.filter(c=>c.id!==id);this.save();return {ok:true};}
 disconnect(){const child=this.child;this.child=null;this.ready=null;this.account=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('연결이 종료되었습니다.'));}this.pending.clear();for(const [id,r] of this.requests)if(r.provider!=='claude')this.requests.delete(id);for(const c of this.chats.filter(c=>c.provider!=='claude')){c.loaded=false;if(c.busy){c.queuePaused=true;c.busy=false;c.status='interrupted';c.turnId=null;}}this.save();if(child){child.stdin.end();return new Promise(resolve=>{const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve();});if(process.platform==='win32')execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else child.kill();});}return Promise.resolve();}
 async close(){this.closing=true;this.queue.stop();for(const c of this.chats)if(c.provider==='claude'&&c.status==='starting'){c.busy=false;c.status='interrupted';}const runs=[...this.claudeRuns.values()].map(r=>r.stop());this.claudeRuns.clear();const done=this.disconnect();await Promise.all([...runs,done]);await this.save();await this.flushSaves();this.closed=true;clearTimeout(this.notifyTimer);clearTimeout(this.checkpointTimer);for(const fn of this.listeners)fn(true);this.listeners.clear();}
}
export function installInteraction(app,current){
 let manager;
 const get=()=>{const context=current();if(!manager||manager.workspace!==context.workspace){manager?.close();manager=new Interaction(context);for(const c of manager.chats)c.loaded=false;}return manager;};
 app.post('/api/interaction/image',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(readChatImage(current().workspace,req.body.path));});
 app.post('/api/interaction/file',async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(await readChatFile(current().workspace,req.body.path));});
 app.get('/api/interaction/events',(req,res)=>{
  const m=get();res.setHeader('Content-Type','text/event-stream');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
  let previous=new Map(),meta='',ended=false;const serialized=new WeakMap();
  const push=(closed=false)=>{
   if(closed){res.end();return;}if(ended)return;
   const state=m.snapshot(),{chats,...head}=state;
   const headers=JSON.stringify({...head,chats:chats.map(({items,...c})=>c)});
   const updates=[];const next=new Map();
   for(const c of chats){const prior=previous.get(c.id)||new Map(),cache=new Map();for(const item of c.items){let json=serialized.get(item);if(!json){json=JSON.stringify(item);serialized.set(item,json);}cache.set(item.id,json);if(prior.get(item.id)!==json)updates.push({chatId:c.id,item});}next.set(c.id,cache);}
   if(headers!==meta||updates.length){res.write('data: '+JSON.stringify({...(headers!==meta?{state:JSON.parse(headers)}:{}),updates})+'\n\n');if(res.writableLength>8*1024*1024)res.end();}
   meta=headers;previous=next;
  };
  const unsubscribe=m.subscribe(push);push();const heartbeat=setInterval(()=>{res.write(': heartbeat\n\n');},15000);
  res.on('close',()=>{ended=true;clearInterval(heartbeat);unsubscribe();});
 });
 app.get('/api/interaction',(_req,res)=>res.json(get().snapshot()));
 app.post('/api/interaction/connect',async(req,res)=>{const m=get();if(req.body?.provider==='claude'){const runtime=await claudeRuntimeAsync(m.env);m.claude={ready:true,sdkVersion:runtime.sdkVersion,engineVersion:runtime.engineVersion,validated:runtime.validated};m.changed();return res.json(m.snapshot());}if(!m.chats.some(c=>c.busy))await m.disconnect();res.json(await m.connect());});
 app.post('/api/interaction/:id/queue',async(req,res)=>res.json(await get().queue.edit(z.string().uuid().parse(req.params.id),z.object({id:z.string().uuid().optional(),text:z.string().optional(),remove:z.boolean().optional(),resume:z.boolean().optional()}).parse(req.body))));
 app.post('/api/interaction/send',async(req,res)=>res.json(await get().send(req.body)));
 app.post('/api/interaction/:id/recover-image',async(req,res)=>res.json(await get().recoverImage(z.string().uuid().parse(req.params.id))));
 app.post('/api/interaction/interrupt',async(req,res)=>res.json(await get().interrupt(z.string().uuid().parse(req.body.id))));
 app.post('/api/interaction/answer',(req,res)=>res.json(get().answer(req.body)));
 app.patch('/api/interaction/:id',(req,res)=>res.json(get().rename(z.string().uuid().parse(req.params.id),req.body.title)));
 app.delete('/api/interaction/:id',(req,res)=>res.json(get().remove(z.string().uuid().parse(req.params.id))));
 return {get,close(){const done=manager?.close();manager=null;return done;}};
}
