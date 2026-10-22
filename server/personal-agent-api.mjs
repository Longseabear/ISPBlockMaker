import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {safeGraphPath} from './graph-storage.mjs';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const terminal=run=>['completed','failed','cancelled','interrupted'].includes(run.status);
export const agentWorkspaceId=workspace=>digest(process.platform==='win32'?path.resolve(workspace).toLowerCase():path.resolve(workspace));
export function installPersonalAgentApi(app,{current,interaction,authorize}){
 const queues=new WeakMap();
 const exclusive=(m,fn)=>{const next=(queues.get(m)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(m,next);return next;};
 const identity=()=>{const c=current();return {id:agentWorkspaceId(c.workspace),name:path.basename(c.workspace),path:c.workspace};};
 const retired=(_req,res)=>res.status(410).json({error:'Agent API moved to the central server manager. Open Advanced options there and issue a central token.'});
 app.use('/api/personal-agent',retired);app.use('/api/agent/v1',retired);
 const base='/api/internal/agent/v1';
 // Only the workspace's rotating local credential can reach this worker API.
 app.use(base,(req,res,next)=>{if(!authorize(req))return res.status(401).json({error:'Missing internal workspace credential'});next();});
 app.get(base+'/workspaces/current',(_req,res)=>res.json({workspace:identity()}));
 const context=req=>{
  const c=current(),id=agentWorkspaceId(c.workspace);if(req.params.workspaceId!==id)fail(409,'Workspace is no longer current; explicitly select the workspace again');
  const m=interaction.get();if(m.workspace!==c.workspace||m.closing)fail(409,'Workspace is changing');return {c,m,id};
 };
 const ensure=(req,m)=>{const next=context(req);if(next.m!==m||!authorize(req))fail(409,'Workspace or API credential changed');};
 const session=(m,id)=>m.chats.find(c=>c.id===id)||fail(404,'Session does not belong to this workspace');
 const info=c=>({id:c.id,title:c.title,provider:c.provider||'codex',status:c.status,busy:!!c.busy,queued:c.queue?.length||0,queue_paused:!!c.queuePaused,diagram_id:c.diagramId||null,block_id:c.blockId||null});
 const requestKey=req=>{const key=z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/).parse(req.headers['idempotency-key']);return digest(agentWorkspaceId(current().workspace)+'\n'+key);};
 const route=base+'/workspaces/:workspaceId';
 app.get(route+'/sessions',(req,res)=>{const {m}=context(req);res.json({sessions:m.chats.map(info)});});
 app.get(route+'/artifacts',(req,res)=>{const {c}=context(req);res.json({artifacts:(c.store.get().artifacts||[]).map(a=>({id:a.id,title:a.title,kind:a.kind,block_id:a.blockId||null,created_at:a.createdAt||null})),note:'Workspace artifacts; no automatic attribution to an API run.'});});
 app.get(route+'/artifacts/:artifactId',(req,res)=>{const {c}=context(req),artifact=c.store.get().artifacts?.find(a=>a.id===req.params.artifactId);if(!artifact||!c.artifactDir)fail(404,'Artifact not found');const file=safeGraphPath(c.artifactDir,artifact.file);if(!fs.existsSync(file))fail(404,'Artifact file not found');res.setHeader('Content-Disposition','attachment');res.sendFile(file);});
 app.post(route+'/sessions',async(req,res)=>{
  const {m,c}=context(req),key=requestKey(req),input=z.object({title:z.string().trim().min(1).max(100).default('API conversation'),provider:z.enum(['claude','codex']).default('claude'),diagram_id:z.string().max(80).optional(),block_id:z.string().max(80).optional()}).strict().parse(req.body),hash=digest(JSON.stringify(canonical(input)));
  const result=await exclusive(m,async()=>{ensure(req,m);const prior=m.apiSessions[key];if(prior){if(prior.hash!==hash)fail(409,'Idempotency-Key conflicts with the original session request');const old=m.chats.find(c=>c.id===prior.id);if(!old)fail(410,'The originally created session has been deleted');return info(old);}
   const graph=c.store.get();if(input.diagram_id&&!graph.diagrams.some(d=>d.id===input.diagram_id))fail(404,'Diagram not found');
   const block=input.block_id?graph.blocks.find(b=>b.id===input.block_id):null;if(input.block_id&&(!block||(input.diagram_id&&block.diagramId!==input.diagram_id)))fail(404,'Block not found in this diagram');
   if(m.chats.length>=50||Object.keys(m.apiSessions).length>=10000)fail(409,'Session limit reached');
   const chat={id:crypto.randomUUID(),title:input.title,provider:input.provider,diagramId:input.diagram_id||block?.diagramId,blockId:input.block_id||'',items:[],busy:false,status:'idle',createdAt:new Date().toISOString()};m.chats.push(chat);m.apiSessions[key]={id:chat.id,hash};await m.save(true);return info(chat);
  });res.status(201).json({session:result});
 });
 app.post(route+'/sessions/:sessionId/messages',async(req,res)=>{
  const {m}=context(req),key=requestKey(req),input=z.object({text:z.string().trim().min(1).max(30000),delivery:z.enum(['queue']).default('queue'),external_ref:z.string().max(200).optional()}).strict().parse(req.body),hash=digest(JSON.stringify(canonical({session:req.params.sessionId,...input})));
  const result=await exclusive(m,async()=>{ensure(req,m);const old=Object.values(m.apiRuns).find(r=>r.key===key);if(old){if(old.hash!==hash)fail(409,'Idempotency-Key conflicts with the original message');return old;}
   const chat=session(m,req.params.sessionId);if((chat.queue||[]).length>=100)fail(409,'Session queue is full');if(Object.keys(m.apiRuns).length>=10000)fail(409,'API run history limit reached');
   const run={id:crypto.randomUUID(),session_id:chat.id,key,hash,status:'queued',created_at:new Date().toISOString(),external_ref:input.external_ref};m.apiRuns[run.id]=run;m.apiEvent(run);
   try{await m.queue.submit({chatId:chat.id,text:input.text,requestId:run.id},{defer:true});}catch(e){chat.queue=(chat.queue||[]).filter(q=>q.id!==run.id);run.status='failed';run.error=e.message;m.apiEvent(run);await m.save(true);throw e;}return run;
  });res.status(202).json({session_id:result.session_id,run_id:result.id,status:result.status});
 });
 const findRun=(m,id)=>m.apiRuns[id]||fail(404,'Run does not belong to this workspace');
 const publicRun=r=>{const {key,hash,start_index,started,...value}=r;return value;};
 app.get(route+'/runs/:runId',(req,res)=>{const {m}=context(req);m.syncApiRuns();const run=findRun(m,req.params.runId),chat=m.chats.find(c=>c.id===run.session_id);res.json({run:publicRun(run),queue_paused:!!chat?.queuePaused,queue_reason:chat?.queueReason||'',questions:!terminal(run)&&chat?.currentApiRun===run.id?[...m.requests.values()].filter(r=>r.params?.chatId===chat.id||(chat.threadId&&r.params?.threadId===chat.threadId)):[]});});
 app.post(route+'/runs/:runId/cancel',async(req,res)=>{const {m}=context(req);const result=await exclusive(m,async()=>{ensure(req,m);const run=findRun(m,req.params.runId);if(terminal(run))return publicRun(run);const chat=session(m,run.session_id),queued=chat.queue?.find(q=>q.id===run.id);
  if(queued?.state==='queued'){chat.queue=chat.queue.filter(q=>q.id!==run.id);run.status='cancelled';m.apiEvent(run);}else {if(chat.currentApiRun!==run.id||!chat.busy)fail(409,'Run dispatch is in progress; retry cancellation after checking its state');run.cancel_requested=true;try{await m.interrupt(chat.id);}catch(error){delete run.cancel_requested;throw error;}}await m.save(true);return publicRun(run);});res.json({run:result});});
 app.post(route+'/runs/:runId/answers',async(req,res)=>{const {m}=context(req);const run=findRun(m,req.params.runId),chat=session(m,run.session_id);if(terminal(run)||chat.currentApiRun!==run.id)fail(409,'Run is not awaiting this answer');const body=z.object({request_id:z.union([z.string(),z.number()]),decision:z.enum(['accept','decline','cancel']).optional(),answers:z.record(z.string(),z.array(z.string().max(10000))).optional()}).strict().parse(req.body);const question=m.requests.get(String(body.request_id));if(!question||!(question.params?.chatId===chat.id||(chat.threadId&&question.params?.threadId===chat.threadId)))fail(409,'Question is expired or belongs to another run');m.answer({id:body.request_id,decision:body.decision,answers:body.answers});await m.save(true);res.json({ok:true});});
 app.get(route+'/events',async(req,res)=>{
  const {m}=context(req);let cursor=z.coerce.number().int().min(0).parse(req.query.after??req.headers['last-event-id']??0);
  if(cursor>m.apiSequence||(m.apiEvents.length&&cursor<m.apiEvents[0].id-1))fail(409,'Event cursor expired or invalid; query run state and reconnect using the latest cursor');
  res.setHeader('Content-Type','text/event-stream');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();let pumping=false,ended=false;
  const push=async closed=>{if(closed){res.end();return;}if(pumping||ended)return;pumping=true;try{ensure(req,m);if(m.apiSequence<=cursor)return;await m.save(true);ensure(req,m);for(const event of m.apiEvents.filter(e=>e.id>cursor)){res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);cursor=event.id;}if(res.writableLength>1024*1024)res.end();}catch{res.end();}finally{pumping=false;}};
  const unsubscribe=m.subscribe(push),timer=setInterval(()=>{void push();if(!ended)res.write(': heartbeat\n\n');},15000);res.on('close',()=>{ended=true;unsubscribe();clearInterval(timer);});void push();
 });
 app.get(route+'/runs',(req,res)=>{const {m}=context(req),limit=z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit),offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset),runs=Object.values(m.apiRuns).reverse();res.json({runs:runs.slice(offset,offset+limit).map(publicRun),total:runs.length,event_cursor:m.apiSequence});});
}
