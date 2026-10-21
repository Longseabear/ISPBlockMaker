import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateGraph} from './model.mjs';
export const blockDirectory=id=>{if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('Invalid block ID');return `board/blocks/b-${id}`;};
export function safeGraphPath(root,relative){
 if(relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(relative))throw Error('Invalid graph path');
 let current=path.resolve(root);
 if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked graph root');
 for(const part of relative.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Linked graph metadata is not supported');}
 return current;
}
function references(raw){
 if(raw.storageVersion!==undefined&&raw.storageVersion!==3)throw Error('Unsupported graph storage version');
 if(raw.storageVersion!==3)return null;
 if(!Array.isArray(raw.blocks))throw Error('Missing block references');
 const used=new Set();
 return raw.blocks.map(b=>{const dir=blockDirectory(b.id);if(used.has(dir.toLowerCase()))throw Error('Block IDs collide on Windows');used.add(dir.toLowerCase());if(b.metadata!==dir+'/block.json')throw Error('Invalid block metadata reference');return {ref:b,dir};});
}
export function readGraph(graphFile){
 const root=path.dirname(graphFile);const raw=JSON.parse(fs.readFileSync(safeGraphPath(root,path.basename(graphFile)),'utf8'));const refs=references(raw);
 if(!refs)return validateGraph(raw);
 const blocks=refs.map(({ref,dir})=>{const data=JSON.parse(fs.readFileSync(safeGraphPath(root,dir+'/block.json'),'utf8'));if(data.id!==ref.id)throw Error('Block identity mismatch');return {...data,id:ref.id,diagramId:ref.diagramId,position:ref.position,detail:fs.readFileSync(safeGraphPath(root,dir+'/README.md'),'utf8')};});
 return validateGraph({...raw,blocks});
}
export async function readGraphAt(read){
 const raw=JSON.parse(await read('graph.json')),refs=references(raw);if(!refs)return validateGraph(raw);
 const blocks=await Promise.all(refs.map(async({ref,dir})=>{const data=JSON.parse(await read(dir+'/block.json'));if(data.id!==ref.id)throw Error('Block identity mismatch');return {...data,id:ref.id,diagramId:ref.diagramId,position:ref.position,detail:await read(dir+'/README.md')};}));
 return validateGraph({...raw,blocks});
}
export function planGraph(graphFile,input){
 const graph=validateGraph(input),root=path.dirname(graphFile),files=[],used=new Set();
 const blocks=graph.blocks.map(({id,diagramId,position,detail,userRequests,jobs,...metadata})=>{
  const dir=blockDirectory(id);if(used.has(dir.toLowerCase()))throw Error('Block IDs collide on Windows');used.add(dir.toLowerCase());
  files.push({path:dir+'/block.json',text:JSON.stringify({id,...metadata},null,2)+'\n'},{path:dir+'/README.md',text:detail});
  return {id,diagramId,position,metadata:dir+'/block.json'};
 });
 files.push({path:path.basename(graphFile),text:JSON.stringify({storageVersion:3,name:graph.name,diagrams:graph.diagrams,overview:graph.overview,blocks,edges:graph.edges},null,2)+'\n'});
 for(const f of files)safeGraphPath(root,f.path);
 return files;
}
export function writeGraph(graphFile,input){
 const root=path.dirname(graphFile),files=planGraph(graphFile,input);
 for(const f of files){const target=safeGraphPath(root,f.path);if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')===f.text)continue;fs.mkdirSync(path.dirname(target),{recursive:true});const tmp=target+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,f.text,{flag:'wx'});fs.renameSync(tmp,target);}
}
export function backupLegacyGraph(graphFile,dataDir){
 const bytes=fs.readFileSync(graphFile),raw=JSON.parse(bytes);if(raw.storageVersion===3)return;
 const graph=validateGraph(raw);const root=path.dirname(graphFile);
 // A legacy checkout may have left managed folders from a newer version. Do not silently overwrite them.
 for(const b of graph.blocks){const dir=safeGraphPath(root,blockDirectory(b.id));if(fs.existsSync(path.join(dir,'block.json'))||fs.existsSync(path.join(dir,'README.md')))throw Error('Legacy graph migration conflicts with existing block folder: '+dir+'. Preserve or move that folder before migrating.');}
 const hash=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16),dest=path.join(dataDir,'migrations','graph-v2-'+hash+'.json');fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,bytes,{flag:'wx'});return dest;
}
export function blockDocuments(graphFile,id){
 const root=path.dirname(graphFile),base=blockDirectory(id),dir=safeGraphPath(root,base+'/docs');const result=[];
 function walk(folder,prefix){if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const rel=prefix+'/'+entry.name,absolute=safeGraphPath(root,rel);if(entry.isDirectory())walk(absolute,rel);else if(entry.isFile()&&entry.name.endsWith('.md'))result.push({path:rel,name:rel.slice(base.length+1)});if(result.length>200)throw Error('Too many block documents');}}
 walk(dir,base+'/docs');return result;
}
