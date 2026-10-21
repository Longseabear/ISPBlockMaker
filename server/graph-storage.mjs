import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateGraph} from './model.mjs';

export const STORAGE_VERSION=4;
function stableId(id){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('Invalid storage ID');return id;}
export const diagramDirectory=id=>`diagrams/d-${stableId(id)}`;
export const blockDirectory=(id,diagramId='main')=>`${diagramDirectory(diagramId)}/blocks/b-${stableId(id)}`;
const legacyDirectory=id=>`board/blocks/b-${stableId(id)}`;
export function safeGraphPath(root,relative){
 if(relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(relative))throw Error('Invalid graph path');
 let current=path.resolve(root);
 if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked graph root');
 for(const part of relative.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Linked graph metadata is not supported');}
 return current;
}
// A shared generator keeps filesystem and historical Git readers identical.
function* decode(raw){
 if(raw.storageVersion===undefined)return validateGraph(raw);
 if(![3,4].includes(raw.storageVersion))throw Error('Unsupported graph storage version');
 let diagrams=raw.diagrams,refs=raw.blocks,edges=raw.edges;
 if(raw.storageVersion===4){
  diagrams=[];refs=[];edges=[];const seen=new Set();
  for(const ref of raw.diagrams){
   const dir=diagramDirectory(ref.id);
   if(seen.has(dir.toLowerCase())||ref.metadata!==dir+'/diagram.json')throw Error('Invalid diagram metadata reference');
   seen.add(dir.toLowerCase());
   const data=JSON.parse(yield dir+'/diagram.json');
   if(data.id!==ref.id)throw Error('Diagram identity mismatch');
   const {blocks,edges:connections,...definition}=data;
   diagrams.push({...definition,overview:{...definition.overview,detail:yield dir+'/README.md'}});
   refs.push(...blocks.map(b=>({...b,diagramId:ref.id})));
   edges.push(...connections);
  }
 }
 const blocks=[],seen=new Set();
 for(const ref of refs){
  const dir=raw.storageVersion===3?legacyDirectory(ref.id):blockDirectory(ref.id,ref.diagramId);
  if(seen.has(ref.id.toLowerCase())||ref.metadata!==dir+'/block.json')throw Error('Invalid block metadata reference');
  seen.add(ref.id.toLowerCase());
  const data=JSON.parse(yield dir+'/block.json');
  if(data.id!==ref.id)throw Error('Block identity mismatch');
  blocks.push({...data,id:ref.id,diagramId:ref.diagramId,position:ref.position,detail:yield dir+'/README.md'});
 }
 if(raw.storageVersion===4){
  const order=(items,ids)=>{if(!Array.isArray(ids)||ids.length!==items.length||new Set(ids).size!==items.length||ids.some(id=>!items.some(x=>x.id===id)))throw Error('Invalid graph order references');return ids.map(id=>items.find(x=>x.id===id));};
  return validateGraph({...raw,diagrams,blocks:order(blocks,raw.blockOrder),edges:order(edges,raw.edgeOrder)});
 }
 return validateGraph({...raw,diagrams,blocks,edges});
}
export function readGraph(graphFile){
 const root=path.dirname(graphFile),read=file=>fs.readFileSync(safeGraphPath(root,file),'utf8');
 const iterator=decode(JSON.parse(read(path.basename(graphFile))));let next=iterator.next();
 while(!next.done)next=iterator.next(read(next.value));return next.value;
}
export async function readGraphAt(read){
 const iterator=decode(JSON.parse(await read('graph.json')));let next=iterator.next();
 while(!next.done)next=iterator.next(await read(next.value));return next.value;
}
export function blockStorageDirectory(graphFile,id){
 const raw=JSON.parse(fs.readFileSync(graphFile,'utf8')),b=readGraph(graphFile).blocks.find(b=>b.id===id);
 if(!b)throw Error('Block not found');return raw.storageVersion===3?legacyDirectory(id):blockDirectory(id,b.diagramId);
}
// Copy supplemental files on migration or reassignment. Originals are retained for
// rollback and existing script references; conflicts never overwrite user files.
function supportingFiles(root,from,to,files){
 if(from===to)return;
 const folder=safeGraphPath(root,from);if(!fs.existsSync(folder))return;
 function walk(relative=''){
  for(const entry of fs.readdirSync(safeGraphPath(root,from+(relative?'/'+relative:'')),{withFileTypes:true})){
   const name=relative?relative+'/'+entry.name:entry.name;
   const source=safeGraphPath(root,from+'/'+name),dest=safeGraphPath(root,to+'/'+name);
   if(entry.isDirectory())walk(name);
   else if(entry.isFile()&&!['block.json','README.md'].includes(name)){
    const bytes=fs.readFileSync(source);
    if(fs.existsSync(dest)&&!fs.readFileSync(dest).equals(bytes))throw Error('Supporting file conflicts: '+to+'/'+name);
    files.push({path:to+'/'+name,text:bytes});
   }
  }
 }
 walk();
}
export function planGraph(graphFile,input){
 const graph=validateGraph(input),root=path.dirname(graphFile),files=[],seen=new Set();
 let old,raw;
 if(fs.existsSync(graphFile)){
  raw=JSON.parse(fs.readFileSync(graphFile,'utf8'));
  // Read only locations here: a recovery journal may be replaying a partially
  // written graph whose metadata is not yet mutually consistent.
  old=raw.storageVersion===4?{blocks:raw.diagrams.flatMap(d=>JSON.parse(fs.readFileSync(safeGraphPath(root,diagramDirectory(d.id)+'/diagram.json'),'utf8')).blocks.map(b=>({...b,diagramId:d.id})))}:raw;
 }
 for(const diagram of graph.diagrams){
  const dir=diagramDirectory(diagram.id);
  if(seen.has(dir.toLowerCase()))throw Error('Diagram IDs collide on Windows');seen.add(dir.toLowerCase());
  const blocks=graph.blocks.filter(b=>b.diagramId===diagram.id).map(({id,diagramId,position,detail,userRequests,jobs,...metadata})=>{
   const base=blockDirectory(id,diagramId);
   if(seen.has(id.toLowerCase()))throw Error('Block IDs collide on Windows');seen.add(id.toLowerCase());
   const previous=old?.blocks.find(b=>b.id===id);
   if(previous)supportingFiles(root,raw.storageVersion===3?legacyDirectory(id):raw.storageVersion===4?blockDirectory(id,previous.diagramId):base,base,files);
   files.push({path:base+'/block.json',text:JSON.stringify({id,...metadata},null,2)+'\n'},{path:base+'/README.md',text:detail});
   return {id,position,metadata:base+'/block.json'};
  });
  const ids=new Set(blocks.map(b=>b.id)),{detail,...overview}=diagram.overview;
  files.push({path:dir+'/README.md',text:detail},{path:dir+'/diagram.json',text:JSON.stringify({...diagram,overview,blocks,edges:graph.edges.filter(e=>ids.has(e.source))},null,2)+'\n'});
 }
 files.push({path:path.basename(graphFile),text:JSON.stringify({storageVersion:4,name:graph.name,overview:graph.overview,diagrams:graph.diagrams.map(d=>({id:d.id,metadata:diagramDirectory(d.id)+'/diagram.json'})),blockOrder:graph.blocks.map(b=>b.id),edgeOrder:graph.edges.map(e=>e.id)},null,2)+'\n'});
 for(const f of files)safeGraphPath(root,f.path);return files;
}
export function writeGraph(graphFile,input){
 const root=path.dirname(graphFile),files=planGraph(graphFile,input);
 // Copy supplements before publishing any changed membership. Journal replay
 // can then recover even if the old diagram no longer references a moved block.
 const ordered=[...files.filter(f=>Buffer.isBuffer(f.text)),...files.filter(f=>!Buffer.isBuffer(f.text))];
 for(const f of ordered){
  const target=safeGraphPath(root,f.path),bytes=Buffer.from(f.text);
  if(fs.existsSync(target)&&fs.readFileSync(target).equals(bytes))continue;
  fs.mkdirSync(path.dirname(target),{recursive:true});const tmp=target+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(tmp,bytes,{flag:'wx'});fs.renameSync(tmp,target);
 }
}
export function backupLegacyGraph(graphFile,dataDir){
 const bytes=fs.readFileSync(graphFile),raw=JSON.parse(bytes);if(raw.storageVersion===4)return;
 const root=path.dirname(graphFile),graph=readGraph(graphFile);
 for(const d of graph.diagrams)for(const name of ['diagram.json','README.md']){
  const target=safeGraphPath(root,diagramDirectory(d.id)+'/'+name);if(fs.existsSync(target))throw Error('Migration conflicts with existing diagram folder: '+target);
 }
 for(const b of graph.blocks)for(const name of ['block.json','README.md']){
  const target=safeGraphPath(root,blockDirectory(b.id,b.diagramId)+'/'+name);if(fs.existsSync(target))throw Error('Migration conflicts with existing block folder: '+target);
 }
 const hash=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16),dest=path.join(dataDir,'migrations',`graph-v${raw.storageVersion||2}-${hash}.json`);
 fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,bytes,{flag:'wx'});
 // v3 source files remain untouched, so the exact root backup still resolves them.
 return dest;
}
export function blockDocuments(graphFile,id){
 const root=path.dirname(graphFile),base=blockStorageDirectory(graphFile,id),dir=safeGraphPath(root,base+'/docs'),result=[];
 function walk(folder,prefix){if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const rel=prefix+'/'+entry.name,absolute=safeGraphPath(root,rel);if(entry.isDirectory())walk(absolute,rel);else if(entry.isFile()&&entry.name.endsWith('.md'))result.push({path:rel,name:rel.slice(base.length+1)});if(result.length>200)throw Error('Too many block documents');}}
 walk(dir,base+'/docs');return result;
}
