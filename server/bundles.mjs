import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {validateGraph} from './model.mjs';
import {writeZip,openZip,sha256,safeName,MAX_FILE,MAX_TOTAL,MAX_FILES} from './bundle-zip.mjs';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const metaName='isp-bundle.json',historyName='.isp/history.gitbundle';
const deniedDirs=new Set(['.git','node_modules','.venv','venv','env','__pycache__','.cache','.pytest_cache','.mypy_cache','.tox','.ssh','.aws','.azure','.codex','.npm']);
export function bundleFilename(projectName){
 let name=String(projectName||'').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').trim().replace(/\.bundle$/i,'').replace(/[. ]+$/g,'');
 name=Array.from(name).slice(0,100).join('').replace(/[. ]+$/g,'')||'workspace';
 if(/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))name='_'+name;
 return name+'.bundle';
}
export function excluded(name,{includeImages=true}={}){
 const parts=name.toLowerCase().split('/'),base=parts.at(-1);
 if(parts[0]==='tmp'||parts.some(s=>deniedDirs.has(s)))return true;
 if(base.endsWith('.bundle')||base.endsWith('.tmp')||/\.py[co]$/.test(base)||/^\.env(?:\.|$)/.test(base)||/^id_(rsa|ed25519|dsa)/.test(base)||/\.(pem|key|pfx|p12)$/.test(base)||['credentials.json','credentials','auth.json','.npmrc','.pypirc'].includes(base))return true;
 if(['.claude','.agents'].includes(parts[0])&&parts[1]!=='skills')return true;
 if(parts[0]==='.isp'){
  if(['project.json','activity.json'].includes(parts[1])&&parts.length===2)return false;
  if(parts[1]==='artifacts')return false;
  if(parts[1]!=='viewer')return true;
  if(['current-view.png','commands.json','crop-selection.json'].includes(parts[2]))return true;
  if(!includeImages&&parts.length===3&&base.endsWith('.bin'))return true;
 }
 return false;
}
async function git(workspace,args){return (await exec('git',['-c','core.hooksPath=',...args],{cwd:workspace,windowsHide:true,maxBuffer:8*1024*1024,timeout:120000})).stdout.trim();}
async function gitInfo(workspace){if(await git(workspace,['rev-parse','--show-toplevel']).then(x=>path.resolve(x)!==workspace))throw new Error('Git history must belong to this workspace, not a parent repository');const head=await git(workspace,['rev-parse','HEAD']);const branch=await git(workspace,['symbolic-ref','--short','-q','HEAD']).catch(()=>null);return {head,branch};}
export async function planBundle(folder,options={}){
 const workspace=await fs.realpath(folder),files=[],skipped=[],names=new Set();let bytes=0;
 if(await fs.stat(path.join(workspace,'.isp/storage-transaction.json')).then(()=>true,()=>false))throw new Error('Pending workspace transaction. Open the workspace before exporting.');
 await fs.readFile(path.join(workspace,'graph.json'),'utf8').then(s=>validateGraph(JSON.parse(s)));
 async function walk(relative=''){
  const dir=path.join(workspace,relative);if((await fs.lstat(dir)).isSymbolicLink())throw new Error('Linked directories are not bundled: '+relative);
  for(const e of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=(relative?relative+'/':'')+e.name;
   if(name===metaName)throw new Error('Reserved filename: '+metaName);
   // Traverse .isp/.agents/.claude containers to reach only the allowed children.
   if(!['.isp','.agents','.claude'].includes(name)&&excluded(name,options)){skipped.push(name);continue;}
   safeName(name);if(names.has(name.toLowerCase()))throw new Error('Case-colliding path: '+name);names.add(name.toLowerCase());const absolute=path.join(workspace,name),stat=await fs.lstat(absolute);if(stat.isSymbolicLink()){skipped.push(name+' (link)');continue;}
   if(stat.isDirectory()){await walk(name);continue;}if(!stat.isFile()){skipped.push(name);continue;}
   if(stat.size>MAX_FILE)throw new Error('File exceeds 256 MiB: '+name);bytes+=stat.size;if(bytes>MAX_TOTAL||files.length>=MAX_FILES)throw new Error('Bundle limit: 2 GiB / 10,000 files');files.push({path:name,size:stat.size,mtime:stat.mtimeMs,source:absolute});
  }
 }
 await walk();const history=options.includeGit?await gitInfo(workspace):null;
 return {workspace,files,skipped,bytes,fileCount:files.length,history,includeImages:options.includeImages!==false,includeGit:!!options.includeGit};
}
export async function packBundle(folder,output,options={}){
 output=path.resolve(output);if(!output.toLowerCase().endsWith('.bundle'))throw new Error('Output filename must end in .bundle');if(await fs.lstat(output).then(()=>true,()=>false))throw new Error('Output already exists');
 const plan=await planBundle(folder,options),temp=await fs.mkdtemp(path.join(os.tmpdir(),'isp-bundle-'));const partial=path.join(path.dirname(output),'.'+path.basename(output)+'.'+path.basename(temp)+'.tmp');
 try{
  const items=[];for(const f of plan.files){if((await fs.lstat(f.source)).isSymbolicLink()||!((await fs.realpath(f.source)).startsWith(plan.workspace+path.sep)))throw new Error('File moved outside workspace: '+f.path);const data=await fs.readFile(f.source);items.push({...f,sha256:sha256(data)});}
  let history=plan.history;if(history){const source=path.join(temp,'history.gitbundle');await git(plan.workspace,['bundle','create',source,'--all','HEAD']);const data=await fs.readFile(source);if(data.length>MAX_FILE)throw new Error('Git history exceeds 256 MiB');items.push({path:historyName,source,size:data.length,sha256:sha256(data)});}
  const manifest={format:'isp-block-maker-bundle',version:1,appVersion:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,createdAt:new Date().toISOString(),name:JSON.parse(await fs.readFile(path.join(plan.workspace,'graph.json'),'utf8')).name,includeImages:plan.includeImages,history,files:items.map(({path,size,sha256})=>({path,size,sha256}))};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2));if(manifestBytes.length>4*1024*1024)throw new Error('Bundle manifest exceeds 4 MiB');
  await writeZip(partial,[...items,{path:metaName,data:manifestBytes}]);
  const after=await planBundle(folder,options);if(JSON.stringify(after.files.map(({path,size,mtime})=>({path,size,mtime})))!==JSON.stringify(plan.files.map(({path,size,mtime})=>({path,size,mtime})))||JSON.stringify(after.history)!==JSON.stringify(history))throw new Error('Workspace changed during export. Pause agent writes and try again.');
  // Exclusive publication prevents replacing an existing bundle.
  await fs.copyFile(partial,output,1);return {path:output,bytes:(await fs.stat(output)).size,fileCount:items.length,manifest};
 }finally{await fs.rm(partial,{force:true});await fs.rm(temp,{recursive:true,force:true});}
}
async function validateLocalRecords(stage,files){
 const json=async name=>files.has(name.toLowerCase())?JSON.parse(await fs.readFile(path.join(stage,name),'utf8')):null;
 const local=await json('.isp/project.json');
 if(local){if(local.storageVersion!==2||!Array.isArray(local.blocks)||!Array.isArray(local.artifacts))throw new Error('Invalid project records');for(const a of local.artifacts){safeName(a.file);if(a.file.includes('/')||!files.has(('.isp/artifacts/'+a.file).toLowerCase()))throw new Error('Missing or unsafe artifact file');}}
 const requests=await json('.isp/viewer/requests.json');
 if(requests){if(!Array.isArray(requests))throw new Error('Invalid Viewer requests');for(const r of requests)for(const crop of [...(r.crops||[]),...(r.result?[r.result]:[])]){for(const value of [Object.values(crop.paths||{}),...(crop.regions||[]).map(region=>Object.values(region.paths||{}))].flat()){safeName(value);if(!value.startsWith('.isp/viewer/results/')||!files.has(value.toLowerCase()))throw new Error('Missing or unsafe crop file');}}}
}
export async function unpackBundle(input,destination){
 destination=path.resolve(destination);if(await fs.lstat(destination).then(()=>true,()=>false))throw new Error('Destination already exists. Choose a new folder.');const parent=await fs.realpath(path.dirname(destination));destination=path.join(parent,path.basename(destination));const zip=await openZip(input);let stage;
 try{
  const entry=zip.entries.find(e=>e.path===metaName);if(!entry||entry.length>4*1024*1024)throw new Error('Missing or oversized ISP bundle manifest');const manifest=JSON.parse((await zip.read(entry)).toString('utf8'));
  if(manifest.format!=='isp-block-maker-bundle'||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length!==zip.entries.length-1)throw new Error('Unsupported ISP bundle version or file list');const byName=new Map(zip.entries.map(e=>[e.path,e])),seen=new Set();
  for(const f of manifest.files){safeName(f.path);if(seen.has(f.path.toLowerCase())||f.path===metaName||!byName.has(f.path)||f.size!==byName.get(f.path).length||!/^([a-f0-9]{64})$/.test(f.sha256)||f.path!==historyName&&excluded(f.path))throw new Error('Invalid or forbidden bundle file: '+f.path);seen.add(f.path.toLowerCase());}
  if(!seen.has('graph.json'))throw new Error('Bundle has no graph.json');
  stage=await fs.mkdtemp(path.join(parent,'.isp-unpack-'));
  for(const f of manifest.files){const bytes=await zip.read(byName.get(f.path));if(sha256(bytes)!==f.sha256)throw new Error('Bundle SHA-256 mismatch: '+f.path);const target=path.join(stage,f.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});}
  validateGraph(JSON.parse(await fs.readFile(path.join(stage,'graph.json'),'utf8')));
  await validateLocalRecords(stage,seen);
  if(manifest.history){if(!/^[a-f0-9]{40,64}$/.test(manifest.history.head)||!seen.has(historyName))throw new Error('Invalid Git history');await git(stage,['-c','init.templateDir=','init','-b','main']);await git(stage,['bundle','verify',path.join(stage,historyName)]);await git(stage,['fetch','--update-head-ok',path.join(stage,historyName),'refs/heads/*:refs/heads/*','refs/tags/*:refs/tags/*','HEAD']);await git(stage,['cat-file','-e',manifest.history.head+'^{commit}']);if(manifest.history.branch){await git(stage,['check-ref-format','--branch',manifest.history.branch]);await git(stage,['symbolic-ref','HEAD','refs/heads/'+manifest.history.branch]);}else await git(stage,['update-ref','--no-deref','HEAD',manifest.history.head]);await git(stage,['reset','--mixed',manifest.history.head]);await fs.unlink(path.join(stage,historyName));}
  // Rebase legacy saved View paths; live View is intentionally regenerated.
  const views=path.join(stage,'.isp/viewer/views.json');if(await fs.stat(views).then(()=>true,()=>false)){const list=JSON.parse(await fs.readFile(views,'utf8'));for(const v of list){if(!/^[a-f0-9-]{36}$/i.test(v.id))throw new Error('Invalid saved view ID');v.paths={image:path.join(destination,'.isp/viewer/views',v.id,'view.png'),metadata:path.join(destination,'.isp/viewer/views',v.id,'metadata.json')};await fs.writeFile(path.join(stage,'.isp/viewer/views',v.id,'metadata.json'),JSON.stringify(v));}await fs.writeFile(views,JSON.stringify(list));}
  // Reserve destination exclusively, then move children. A failed import only removes our new folder.
  await fs.mkdir(destination);try{for(const child of await fs.readdir(stage))await fs.rename(path.join(stage,child),path.join(destination,child));}catch(e){await fs.rm(destination,{recursive:true,force:true});throw e;}
  return {workspace:destination,manifest};
 }finally{await zip.close();if(stage)await fs.rm(stage,{recursive:true,force:true});}
}
