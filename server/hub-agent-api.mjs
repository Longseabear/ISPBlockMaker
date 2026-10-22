import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {agentWorkspaceId} from './personal-agent-api.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
export class HubAgentAccess {
 constructor(folder){this.file=path.join(folder,'agent-api.json');this.listeners=new Set();}
 read(){if(!fs.existsSync(this.file))return {enabled:false,workspace_ids:[]};if(fs.lstatSync(this.file).isSymbolicLink())fail(400,'Linked agent settings are unsupported');return read(this.file);}
 authorized(req){const c=this.read(),s=req.headers.authorization||'';return c.enabled&&s.startsWith('Bearer ')&&hash(s.slice(7))===c.tokenHash;}
 update(action,workspaceIds,projects){
  const previous=this.read();const ids=workspaceIds===undefined?previous.workspace_ids:[...new Set(z.array(z.string().uuid()).max(100).parse(workspaceIds))];
  if(action!=='disable'&&(ids.length===0||ids.some(id=>!projects.some(p=>p.id===id))))fail(400,'Select at least one registered workspace');
  const token=['enable','rotate'].includes(action)?crypto.randomBytes(32).toString('hex'):null;
  const config={enabled:action==='disable'?false:action==='scope'?!!previous.enabled:true,workspace_ids:ids,tokenHash:action==='disable'?null:token?hash(token):previous.tokenHash};
  const temp=this.file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(config),{flag:'wx',mode:0o600});fs.renameSync(temp,this.file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  for(const listener of this.listeners)listener();return token;
 }
}

// Resolve only registered workspaces, never a caller-supplied destination URL.
export async function hubWorkerTarget(project){
 let record;try{record=read(path.join(project.path,'.isp','connection.json'));}catch{fail(503,'Workspace server is offline');}
 let url;try{url=new URL(record.url);}catch{fail(503,'Workspace server address is unavailable');}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!record.token)fail(503,'Invalid workspace server address');
 let response,health;try{response=await fetch(url.origin+'/health',{redirect:'error',signal:AbortSignal.timeout(2000)});health=await response.json();}catch{fail(503,'Workspace server is offline');}
 if(!response.ok||health.app!=='ISPBlockMaker'||!samePath(path.resolve(health.workspace||''),path.resolve(project.path)))fail(409,'Workspace server identity changed');
 if(health.agentApi!==1)fail(409,'Workspace server needs an update/restart for the central Agent API');
 return {origin:url.origin,token:record.token,instance:health.instance,workerId:agentWorkspaceId(health.workspace)};
}

export function installHubAgentApi(app,{stateRoot,list,url,resolveTarget=hubWorkerTarget}){
 const access=new HubAgentAccess(stateRoot),streams=new Set();
 const settings=()=>{const c=access.read();return {enabled:!!c.enabled,workspace_ids:c.workspace_ids,base_url:url()+'/api/agent/v1',access:'localhost'};};
 app.get('/api/agent-settings',async(_req,res)=>res.json({...settings(),workspaces:(await list()).map(({id,name,running})=>({id,name,running}))}));
 app.post('/api/agent-settings',async(req,res)=>{const {action,workspace_ids}=z.object({action:z.enum(['enable','rotate','scope','disable']),workspace_ids:z.array(z.string().uuid()).optional()}).strict().parse(req.body);const token=access.update(action,workspace_ids,await list());res.json({...settings(),...(token?{token}:{})});});
 const base='/api/agent/v1';
 app.use(base,(req,res,next)=>access.authorized(req)?next():res.status(401).json({error:'Central Agent API is disabled or token is invalid'}));
 const allowed=async()=>{const ids=access.read().workspace_ids;return (await list()).filter(p=>ids.includes(p.id));};
 const select=async(req)=>{const project=(await allowed()).find(p=>p.id===req.params.workspaceId);if(!project)fail(404,'Workspace is not registered or is not allowed for this API');if(!access.authorized(req))fail(401,'Agent credential changed');return project;};
 app.get(base+'/workspaces',async(_req,res)=>res.json({workspaces:(await allowed()).map(({id,name,running})=>({id,name,status:running?'online':'offline'}))}));
 app.get(base+'/workspaces/current',(_req,res)=>res.status(409).json({error:'Use /workspaces and explicitly select workspace_id. UI selection is not an API target.'}));
 const workerFetch=async(project,suffix,{method='GET',headers={},body,signal}={})=>{
  const target=await resolveTarget(project);signal?.throwIfAborted();let response;
  try{response=await fetch(`${target.origin}/api/internal/agent/v1/workspaces/${target.workerId}${suffix}`,{method,headers:{Authorization:`Bearer ${target.token}`,'Content-Type':'application/json',...headers},body,redirect:'error',signal:signal||AbortSignal.timeout(15000)});}catch{fail(503,'Workspace server connection failed; query the run before retrying a mutation');}
  return {response,target};
 };
 // Aggregation is read-only and never opens stopped workspaces or changes selection.
 for(const kind of ['sessions','runs'])app.get(base+'/'+kind,async(req,res)=>{
  const items=await allowed();const groups=await Promise.all(items.map(async p=>{try{const {response}=await workerFetch(p,'/'+kind);if(!response.ok)throw Error('Workspace query failed');const data=JSON.parse(await readBounded(response,2*1024*1024));return {workspace_id:p.id,status:'online',[kind]:data[kind],...(kind==='runs'?{total:data.total,event_cursor:data.event_cursor}:{})};}catch(error){return {workspace_id:p.id,status:'unavailable',error:error.message};}}));
  if(!access.authorized(req))fail(401,'Agent credential changed');res.json({workspaces:groups});
 });
 const routes=[['get','sessions'],['post','sessions'],['post','sessions/:sessionId/messages'],['get','runs'],['get','runs/:runId'],['post','runs/:runId/cancel'],['post','runs/:runId/answers'],['get','artifacts'],['get','artifacts/:artifactId'],['get','events']];
 for(const [method,suffix] of routes)app[method](base+'/workspaces/:workspaceId/'+suffix,async(req,res)=>{
  const project=await select(req);const parts=suffix.split('/').map(part=>part.startsWith(':')?encodeURIComponent(z.string().uuid().parse(req.params[part.slice(1)])):part);const query=new URLSearchParams();
  const fields=suffix==='events'?['after']:suffix==='runs'?['offset','limit']:[];
  for(const field of fields)if(req.query[field]!==undefined)query.set(field,z.string().max(20).regex(/^\d+$/).parse(req.query[field]));
  if(suffix==='events'&&req.headers['last-event-id']&&!query.has('after'))query.set('after',z.string().max(20).regex(/^\d+$/).parse(req.headers['last-event-id']));
  const controller=new AbortController();const abort=()=>controller.abort();streams.add(controller);
  res.on('close',abort);let watchdog,bodyTimer;
  const check=()=>{if(!access.authorized(req)||!access.read().workspace_ids.includes(project.id))abort();};access.listeners.add(check);
  try{
   check();if(controller.signal.aborted)fail(401,'Agent access changed');
   const headers={};if(req.headers['idempotency-key'])headers['Idempotency-Key']=z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/).parse(req.headers['idempotency-key']);
   // No retries for writes: the same key must be deliberately reused by the bridge.
   const initialTimer=setTimeout(abort,15000);let response,target;
   try{({response,target}=await workerFetch(project,'/'+parts.join('/')+(query.size?'?'+query:''),{method:method.toUpperCase(),headers,body:method==='post'?JSON.stringify(req.body):undefined,signal:controller.signal}));}finally{clearTimeout(initialTimer);}
   check();if(controller.signal.aborted)fail(401,'Agent access changed');
   const type=response.headers.get('content-type')||'';res.status(response.status);
   if(type.includes('text/event-stream')&&response.ok){
    res.setHeader('Content-Type','text/event-stream');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
    let checking=false;watchdog=setInterval(async()=>{if(checking)return;checking=true;try{check();const current=await resolveTarget(project);if(current.instance!==target.instance)abort();}catch{abort();}finally{checking=false;}},5000);
   }else if(suffix==='artifacts/:artifactId'&&response.ok){res.setHeader('Content-Type',type||'application/octet-stream');res.setHeader('Content-Disposition','attachment');}
   else {
    if(!type.includes('json'))fail(502,'Workspace returned an incompatible response; restart it');
    bodyTimer=setTimeout(abort,15000);const bytes=await readBounded(response,2*1024*1024);check();if(controller.signal.aborted)fail(401,'Agent access changed');res.type('json').send(bytes);return;
   }
   const reader=response.body.getReader();try{while(!controller.signal.aborted){const {done,value}=await reader.read();if(done)break;if(!res.write(value))await waitForDrain(res);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}res.end();
  }catch(error){if(res.headersSent)res.end();else if(controller.signal.aborted)res.status(409).json({error:'Connection or authorization changed; reconnect and query the run state'});else throw error;}
  finally{clearInterval(watchdog);clearTimeout(bodyTimer);access.listeners.delete(check);res.off('close',abort);streams.delete(controller);controller.abort();}
 });
 app.get(base+'/openapi.json',(_req,res)=>res.json(agentOpenApi(url())));
 return {access,close(){for(const c of streams)c.abort();}};
}
function waitForDrain(res){return new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);if(res.destroyed)done();});}
async function readBounded(response,limit){const reader=response.body.getReader(),chunks=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)fail(502,'Workspace response is too large');chunks.push(value);}return Buffer.concat(chunks);}finally{await reader.cancel();reader.releaseLock();}}

function agentOpenApi(origin){
 const paths={};const add=(route,method,description,body)=>{const parameters=[...route.matchAll(/\{(\w+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string',format:'uuid'}}));if(body)parameters.push({name:'Idempotency-Key',in:'header',required:route.endsWith('/sessions')||route.endsWith('/messages'),schema:{type:'string',minLength:1,maxLength:200}});
  (paths[route]||={})[method]={description,parameters,...(body?{requestBody:{required:true,content:{'application/json':{schema:body}}}}:{}),responses:{[method==='post'&&route.endsWith('/messages')?'202':method==='post'&&route.endsWith('/sessions')?'201':'200']:{description:'Successful response'},'401':{description:'Token invalid or API disabled'},'404':{description:'Unknown or disallowed target'},'409':{description:'State or idempotency conflict'},'503':{description:'Workspace server offline'}}};};
 add('/workspaces','get','List allowed workspace IDs and online/offline status.');add('/sessions','get','Group current sessions by workspace. Unavailable workers are reported explicitly.');add('/runs','get','Group the latest 50 runs per workspace; use scoped pagination for more.');
 const w='/workspaces/{workspaceId}';add(w+'/sessions','get','List sessions belonging to this workspace.');add(w+'/sessions','post','Create a session without executing a prompt.',{type:'object',additionalProperties:false,properties:{title:{type:'string',maxLength:100},provider:{enum:['claude','codex'],default:'claude'},diagram_id:{type:'string'},block_id:{type:'string'}}});add(w+'/sessions/{sessionId}/messages','post','Queue a prompt and return run_id. Reuse the same idempotency key on retry.',{type:'object',required:['text'],additionalProperties:false,properties:{text:{type:'string',minLength:1,maxLength:30000},delivery:{enum:['queue']},external_ref:{type:'string',maxLength:200}}});
 add(w+'/runs','get','List runs with limit (1–100) and offset query parameters; includes event_cursor.');add(w+'/runs/{runId}','get','Read status, output, errors and pending questions.');add(w+'/runs/{runId}/cancel','post','Cancel queued work or request interruption.',{type:'object'});add(w+'/runs/{runId}/answers','post','Answer a pending question owned by this run.',{type:'object',required:['request_id'],properties:{request_id:{type:['string','number']},decision:{enum:['accept','decline','cancel']},answers:{type:'object',additionalProperties:{type:'array',items:{type:'string'}}}}});add(w+'/events','get','SSE stream. Resume with after query or Last-Event-ID. Cursor is scoped to this workspace.');add(w+'/artifacts','get','List workspace artifacts; does not infer run ownership.');add(w+'/artifacts/{artifactId}','get','Download a registered artifact.');
 return {openapi:'3.1.0',info:{title:'ISP Block Maker Central Agent API',version:'1.0.0'},servers:[{url:origin+'/api/agent/v1'}],security:[{bearer:[]}],components:{securitySchemes:{bearer:{type:'http',scheme:'bearer'}}},paths};
}
