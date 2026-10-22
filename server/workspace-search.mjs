import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {z} from 'zod';
import {blockStorageDirectory,diagramDirectory,safeGraphPath} from './graph-storage.mjs';
import {evidenceWindow} from './search-evidence.mjs';

const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const searchInput=z.object({query:z.string().trim().min(1).max(500),mode:z.enum(['all','any']).default('any'),diagram_id:z.string().optional(),block_id:z.string().optional(),types:z.array(z.enum(['diagram','block','document','source','job'])).optional(),limit:z.number().int().min(1).max(50).default(10),offset:z.number().int().min(0).max(10000).default(0)}).strict();
export class WorkspaceSearch {
 constructor({sourceRoot,dataDir,store}){this.root=sourceRoot;this.dataDir=dataDir;this.store=store;this.pending=new Map();this.seq=0;this.documents=new Map();this.key='';this.generation=0;this.serial=Promise.resolve();this.closed=false;}
 async start(){
  if(this.worker)return;
  await fs.mkdir(path.join(this.dataDir,'search'),{recursive:true});
  if(this.closed)throw Error('Search closed');
  const worker=new Worker(new URL('./search-worker.mjs',import.meta.url),{workerData:{file:path.join(this.dataDir,'search','index.sqlite')}});this.worker=worker;
  worker.on('message',m=>{if(this.worker!==worker)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
  const failed=e=>{if(this.worker!==worker)return;this.worker=null;this.key='';for(const p of this.pending.values())p.reject(e);this.pending.clear();};
  worker.on('error',failed);worker.on('exit',()=>failed(Error('Search worker stopped')));
 }
 async call(action,payload){if(this.closed)throw Error('Search closed');await this.start();return new Promise((resolve,reject)=>{const id=++this.seq;this.pending.set(id,{resolve,reject});this.worker.postMessage({id,action,payload});});}
 async collect(){
  const graph=this.store.get(),graphFile=path.join(this.root,'graph.json'),docs=[],skipped=[];
  const add=(id,title,text,meta)=>docs.push({id,title,text,hash:hash(text),...meta});
  const read=async(relative,meta)=>{
   const file=safeGraphPath(this.root,relative);let stat;
   try{stat=await fs.stat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}
   if(!stat.isFile()||stat.size>1024*1024){skipped.push({path:relative,reason:'size-or-type'});return;}
   const bytes=await fs.readFile(file);if(bytes.includes(0)){skipped.push({path:relative,reason:'binary'});return;}
   add('file:'+relative,meta.title||path.basename(relative),bytes.toString('utf8'),{...meta,path:relative});
  };
  const walk=async(base,meta)=>{
   let entries;try{entries=await fs.readdir(safeGraphPath(this.root,base),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
   for(const e of entries){const rel=base+'/'+e.name;safeGraphPath(this.root,rel);if(e.isDirectory())await walk(rel,meta);else if(/\.(md|txt)$/i.test(e.name))await read(rel,meta);if(docs.length>10000)throw Error('Search document limit exceeded');}
  };
  for(const d of graph.diagrams){
   add('diagram:'+d.id,d.name,JSON.stringify(d,null,2),{type:'diagram',diagram_id:d.id,field:'diagram'});
   const base=diagramDirectory(d.id);await read(base+'/README.md',{type:'document',diagram_id:d.id,title:d.name});await walk(base+'/docs',{type:'document',diagram_id:d.id});
  }
  for(const b of graph.blocks){
   const {jobs,userRequests,...definition}=b;
   add('block:'+b.id,b.name,JSON.stringify(definition,null,2),{type:'block',diagram_id:b.diagramId,block_id:b.id,field:'block'});
   const base=blockStorageDirectory(graphFile,b.id),meta={type:'document',diagram_id:b.diagramId,block_id:b.id};
   await read(base+'/README.md',{...meta,title:b.name});await walk(base+'/docs',meta);
   if(b.implementation){
    const relative=b.implementation.replaceAll('\\','/');
    // Only explicit block source references, never a recursive project scan.
    if(/\.(py|c|cc|cpp|h|hpp|m|rs|go|js|mjs|ts|tsx|jsx|sh|ps1|cmd)$/i.test(relative)&&!relative.split('/').some(p=>['.git','.isp','node_modules','.venv','venv'].includes(p))){
     const existing=docs.find(d=>d.type==='source'&&d.path===relative);
     if(existing){existing.block_ids.push(b.id);if(!existing.diagram_ids.includes(b.diagramId))existing.diagram_ids.push(b.diagramId);}
     else try{await read(relative,{type:'source',block_id:b.id,diagram_id:b.diagramId,block_ids:[b.id],diagram_ids:[b.diagramId],title:path.basename(relative)});}catch(e){skipped.push({path:relative,reason:'unavailable-source'});}
    }
   }
   for(const job of jobs||[])add('job:'+b.id+':'+job.id,job.title,JSON.stringify(job,null,2),{type:'job',diagram_id:b.diagramId,block_id:b.id,field:'job'});
  }
  for(const job of graph.globalWork?.jobs||[])add('job:global:'+job.id,job.title,JSON.stringify(job,null,2),{type:'job',field:'globalWork.jobs'});
  return {docs,skipped,revision:graph.revision};
 }
 allowed(d,input,scope){return (!input.diagram_id||d.diagram_id===input.diagram_id||d.diagram_ids?.includes(input.diagram_id))&&(!input.block_id||d.block_id===input.block_id||d.block_ids?.includes(input.block_id))&&(!input.types||input.types.includes(d.type))&&(!scope?.public||['diagram','block','document'].includes(d.type)||(d.type==='source'&&scope.documentIds?.includes(d.id)));}
 catalog(){return this.exclusive(async()=>{await this.refresh();return {sources:[...this.documents.values()].filter(d=>d.type==='source').map(({id,title,path,hash,block_ids,diagram_ids})=>({id,title,path,hash,block_ids,diagram_ids}))};});}
 async refresh(){
  const value=await this.collect(),key=hash(JSON.stringify(value));
  if(key!==this.key){const result=await this.call('index',{documents:value.docs});this.documents=new Map(value.docs.map(d=>[d.id,d]));this.key=key;this.generation=result.generation;}
  return value;
 }
 exclusive(fn){const result=this.serial.then(fn);this.serial=result.catch(()=>{});return result;}
 search(raw,scope={}){return this.exclusive(async()=>{
  const input=searchInput.parse(raw),value=await this.refresh(),allowedIds=[...this.documents.values()].filter(d=>this.allowed(d,input,scope)).map(d=>d.id);
  const result=await this.call('search',{...input,allowedIds});
  return {...result,revision:value.revision,skipped:scope.public?undefined:value.skipped,results:result.results.map(({text,...d})=>{
   const lines=text.split(/\r?\n/),words=input.query.toLowerCase().replaceAll('"','').split(/\s+/),at=Math.max(0,lines.findIndex(line=>words.some(w=>line.toLowerCase().includes(w)))),start=Math.max(0,at-2),end=Math.min(lines.length,start+8);
   const {text:excerpt,...window}=evidenceWindow(lines,start,end-start,1200);
   return {...d,...window,excerpt};
  })};
 });}
 read(raw,scope={}){return this.exclusive(async()=>{
  const input=z.object({document_id:z.string(),hash:z.string().optional(),start_line:z.number().int().min(1).default(1),max_lines:z.number().int().min(1).max(200).default(80)}).strict().parse(raw);
  const value=await this.refresh(),d=this.documents.get(input.document_id);if(!d||!this.allowed(d,{},scope))throw Error('Document not found');
  if(input.hash&&input.hash!==d.hash)throw Error('Document changed; search again');
  const window=evidenceWindow(d.text.split(/\r?\n/),input.start_line-1,input.max_lines,24000);
  return {...d,...window,has_more:window.end_line<d.text.split(/\r?\n/).length||window.partial_last_line,generation:this.generation,revision:value.revision};
 });}
 async close(){this.closed=true;if(this.worker)await this.worker.terminate();}
}
