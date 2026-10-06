import fs from 'node:fs';
import path from 'node:path';
import {hubStateRoot} from './hub.mjs';
import {findWorkspaceServer} from './workspace-open.mjs';

// Read-only catalog; listing does not start servers or change workspace contents.
export async function listWorkspaces(current,stateRoot=hubStateRoot()){
 const paths=new Set([current]);
 const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
 for(const p of read(path.join(stateRoot,'hub-projects.json'))||[])if(typeof p.path==='string')paths.add(p.path);
 if(fs.existsSync(stateRoot))for(const entry of fs.readdirSync(stateRoot,{withFileTypes:true}).filter(e=>e.isDirectory()))for(const name of ['connection.json','active-workspace.json']){
  const record=read(path.join(stateRoot,entry.name,name));const folder=record?.workspace||record?.path;if(typeof folder==='string')paths.add(folder);
 }
 const unique=new Map();
 for(const folder of paths){let canonical=path.resolve(folder);try{canonical=fs.realpathSync(canonical);}catch{}unique.set(process.platform==='win32'?canonical.toLowerCase():canonical,canonical);}
 return Promise.all([...unique.values()].map(async folder=>{let url=null;try{url=await findWorkspaceServer(folder);}catch{}return {path:folder,name:path.basename(folder),running:!!url,url,current:path.resolve(current).toLowerCase()===folder.toLowerCase()};}));
}
