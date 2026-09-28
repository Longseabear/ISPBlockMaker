import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {validateGraph} from './model.mjs';
import {sourceRoot,normalizeWorkspaceFolder} from './project-layout.mjs';
import {referenceManifest} from './reference-sets.mjs';
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
export function excluded(name,{includeImages=true,includeVisualizations=true,includeViewer=true,includeData=true}={}){
 const parts=name.toLowerCase().split('/'),base=parts.at(-1);
 if(!includeData&&parts[0]==='data')return true;
 if(parts[0]==='tmp'||parts[0]==='project'&&parts[1]==='tmp'||parts.some(s=>deniedDirs.has(s)))return true;
 if(base.endsWith('.bundle')||base.endsWith('.tmp')||/\.py[co]$/.test(base)||/^\.env(?:\.|$)/.test(base)||/^id_(rsa|ed25519|dsa)/.test(base)||/\.(pem|key|pfx|p12)$/.test(base)||['credentials.json','credentials','auth.json','.npmrc','.pypirc'].includes(base))return true;
 if(['.claude','.agents'].includes(parts[0])&&parts[1]!=='skills')return true;
 if(parts[0]==='project'&&parts[1]==='.isp')return true;
 if(parts[0]==='project'&&['.agents','.claude'].includes(parts[1])&&parts[2]!=='skills')return true;
 if(parts[0]==='.isp'){
  if(parts[1]==='reference-sets')return parts.slice(2).some(p=>p.startsWith('.'));
  if(['project.json','activity.json','workspace.json','tracking.json'].includes(parts[1])&&parts.length===2)return false;
  if(parts[1]==='artifacts')return !includeVisualizations;
  if(parts[1]!=='viewer')return true;
  if(!includeViewer)return true;
  if(['current-view.png','commands.json','crop-selection.json'].includes(parts[2]))return true;
  if(!includeImages&&parts.length===3&&base.endsWith('.bin'))return true;
 }
 return false;
}
async function git(workspace,args){return (await exec('git',['-c','core.hooksPath=',...args],{cwd:workspace,windowsHide:true,maxBuffer:8*1024*1024,timeout:120000})).stdout.trim();}
async function gitInfo(source){
 if(await git(source,['rev-parse','--show-toplevel']).then(async x=>await fs.realpath(x)!==await fs.realpath(source)))throw new Error('Git history must belong to this project, not a parent repository');
 const head=await git(source,['rev-parse','--verify','HEAD']).catch(()=>null),branch=await git(source,['symbolic-ref','--short','-q','HEAD']).catch(()=>null);
 // Checkpoints may be newer than HEAD; include their refs in the export consistency check.
 const refs=(await git(source,['for-each-ref','--format=%(refname) %(objectname)'])).split('\n').filter(Boolean).map(line=>{const [ref,hash]=line.split(' ');return {ref,hash};});
 return {head,branch,empty:!head&&!refs.length,refsDigest:sha256(Buffer.from(JSON.stringify(refs))),checkpointRefs:refs.filter(item=>item.ref.startsWith('refs/isp/checkpoints/')),recoveryRefs:refs.filter(item=>item.ref.startsWith('refs/isp/recovery/'))};
}
function sourceRelative(workspace,source){const relative=path.relative(workspace,source).split(path.sep).join('/')||'.';if(!['.','project'].includes(relative))throw new Error('Unsupported project source root');return relative;}
export async function planBundle(folder,options={}){
 const workspace=normalizeWorkspaceFolder(folder),files=[],skipped=[],names=new Set();let bytes=0;
 if(await fs.stat(path.join(workspace,'.isp/storage-transaction.json')).then(()=>true,()=>false))throw new Error('Pending workspace transaction. Open the workspace before exporting.');
 const source=sourceRoot(workspace),relativeSource=sourceRelative(workspace,source),graphPath=path.join(source,'graph.json');
 if((await fs.lstat(graphPath)).isSymbolicLink())throw new Error('Linked graph files are not bundled');
 await fs.readFile(graphPath,'utf8').then(s=>validateGraph(JSON.parse(s)));
 const recordsPath=path.join(workspace,'.isp/project.json');
 const records=await fs.readFile(recordsPath,'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return null;throw error;});
 const availableArtifacts=(records?.artifacts||[]).map(({id,title,kind,file,blockId})=>({id,title,kind,file,blockId}));
 if(options.artifactIds!==undefined&&(!Array.isArray(options.artifactIds)||options.artifactIds.some(id=>typeof id!=='string'||!availableArtifacts.some(a=>a.id===id))))throw new Error('Unknown visualization selected. Refresh the bundle preview.');
 const selectedArtifactIds=options.includeVisualizations===false?[]:options.artifactIds??availableArtifacts.map(a=>a.id);
 const selectedFiles=new Set(availableArtifacts.filter(a=>selectedArtifactIds.includes(a.id)).map(a=>'.isp/artifacts/'+a.file));
 const filterArtifacts=options.includeVisualizations===false||options.artifactIds!==undefined;
 const transformed=records&&filterArtifacts?Buffer.from(JSON.stringify({...records,artifacts:records.artifacts.filter(a=>selectedArtifactIds.includes(a.id))},null,2)+'\n'):null;
 async function walk(relative=''){
  const dir=path.join(workspace,relative);if((await fs.lstat(dir)).isSymbolicLink())throw new Error('Linked directories are not bundled: '+relative);
  for(const e of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=(relative?relative+'/':'')+e.name;
   if(name===metaName)throw new Error('Reserved filename: '+metaName);
   if(!relative&&relativeSource==='project'&&!['project','.isp','.agents','.claude','AGENTS.md','CLAUDE.md','isp.cmd','isp.mjs','data'].includes(name)){skipped.push(name);continue;}
   // Traverse .isp/.agents/.claude containers to reach only the allowed children.
   if(!['.isp','.agents','.claude','project/.agents','project/.claude'].includes(name)&&excluded(name,options)){skipped.push(name);continue;}
   safeName(name);if(names.has(name.toLowerCase()))throw new Error('Case-colliding path: '+name);names.add(name.toLowerCase());const absolute=path.join(workspace,name),stat=await fs.lstat(absolute);if(stat.isSymbolicLink()){skipped.push(name+' (link)');continue;}
   if(stat.isDirectory()){await walk(name);continue;}if(!stat.isFile()){skipped.push(name);continue;}
   if(filterArtifacts&&name.startsWith('.isp/artifacts/')&&!selectedFiles.has(name)){skipped.push(name);continue;}
   const data=name==='.isp/project.json'?transformed:null,size=data?data.length:stat.size;
   if(size>MAX_FILE)throw new Error('File exceeds 256 MiB: '+name);bytes+=size;if(bytes>MAX_TOTAL||files.length>=MAX_FILES)throw new Error('Bundle limit: 2 GiB / 10,000 files');files.push({path:name,size,mtime:stat.mtimeMs,source:absolute,...(data?{data,sourceHash:sha256(await fs.readFile(absolute))}:{})});
  }
 }
 await walk();for(const file of selectedFiles)if(!files.some(f=>f.path===file))throw new Error('Missing selected visualization file: '+file);const history=options.includeGit?await gitInfo(source):null;
 return {workspace,sourceRoot:relativeSource,files,skipped,bytes,fileCount:files.length,history,availableArtifacts,selectedArtifactIds,includeImages:options.includeImages!==false,includeGit:!!options.includeGit,includeVisualizations:options.includeVisualizations!==false,includeViewer:options.includeViewer!==false,includeData:options.includeData!==false};
}
export async function packBundle(folder,output,options={}){
 output=path.resolve(output);if(!output.toLowerCase().endsWith('.bundle'))throw new Error('Output filename must end in .bundle');if(await fs.lstat(output).then(()=>true,()=>false))throw new Error('Output already exists');
 const plan=await planBundle(folder,options),temp=await fs.mkdtemp(path.join(os.tmpdir(),'isp-bundle-'));const partial=path.join(path.dirname(output),'.'+path.basename(output)+'.'+path.basename(temp)+'.tmp');
 try{
  const items=[];for(const f of plan.files){if((await fs.lstat(f.source)).isSymbolicLink()||!((await fs.realpath(f.source)).startsWith(plan.workspace+path.sep)))throw new Error('File moved outside workspace: '+f.path);const original=await fs.readFile(f.source);if(f.sourceHash&&sha256(original)!==f.sourceHash)throw new Error('Workspace changed during export. Refresh and try again.');const data=f.data??original;items.push({...f,sha256:sha256(data)});}
  const project=path.resolve(plan.workspace,plan.sourceRoot),history=plan.history;if(history&&!history.empty){const source=path.join(temp,'history.gitbundle');await git(project,['bundle','create',source,'--all',...(history.head?['HEAD']:[])]);const data=await fs.readFile(source);if(data.length>MAX_FILE)throw new Error('Git history exceeds 256 MiB');items.push({path:historyName,source,size:data.length,sha256:sha256(data)});}
  const manifest={format:'isp-block-maker-bundle',version:2,sourceRoot:plan.sourceRoot,appVersion:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,createdAt:new Date().toISOString(),name:JSON.parse(await fs.readFile(path.join(project,'graph.json'),'utf8')).name,includeImages:plan.includeImages,includeViewer:plan.includeViewer,includeVisualizations:plan.includeVisualizations,includeData:plan.includeData,artifactIds:plan.selectedArtifactIds,history,files:items.map(({path,size,sha256})=>({path,size,sha256}))};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2));if(manifestBytes.length>4*1024*1024)throw new Error('Bundle manifest exceeds 4 MiB');
  await writeZip(partial,[...items,{path:metaName,data:manifestBytes}]);
  const after=await planBundle(folder,options);if(after.sourceRoot!==plan.sourceRoot||JSON.stringify(after.files.map(({path,size,mtime})=>({path,size,mtime})))!==JSON.stringify(plan.files.map(({path,size,mtime})=>({path,size,mtime})))||JSON.stringify(after.history)!==JSON.stringify(history))throw new Error('Workspace changed during export. Pause agent writes and try again.');
  // Exclusive publication prevents replacing an existing bundle.
  await fs.copyFile(partial,output,1);return {path:output,bytes:(await fs.stat(output)).size,fileCount:items.length,manifest};
 }finally{await fs.rm(partial,{force:true});await fs.rm(temp,{recursive:true,force:true});}
}
async function validateLocalRecords(stage,files){
 for(const file of files){if(!file.startsWith('.isp/reference-sets/'))continue;
  if(!/^\.isp\/reference-sets\/[a-f0-9-]{36}\/(manifest\.json|files\/[a-f0-9-]{36}\.bin)$/.test(file))throw new Error('Invalid reference set path');
  if(!files.has(file.split('/').slice(0,3).join('/')+'/manifest.json'))throw new Error('Reference manifest missing');
  if(file.endsWith('/manifest.json')){const set=referenceManifest.parse(JSON.parse(await fs.readFile(path.join(stage,file),'utf8')));if(file!==`.isp/reference-sets/${set.id}/manifest.json`)throw new Error('Reference set ID mismatch');for(const item of set.files){const expected=`.isp/reference-sets/${set.id}/files/${item.id}.bin`;if(item.file!==`files/${item.id}.bin`||!files.has(expected))throw new Error('Missing reference data');const bytes=await fs.readFile(path.join(stage,expected));if(bytes.length!==item.size||sha256(bytes)!==item.sha256)throw new Error('Reference data checksum mismatch');}}
 }
 const json=async name=>files.has(name.toLowerCase())?JSON.parse(await fs.readFile(path.join(stage,name),'utf8')):null;
 const local=await json('.isp/project.json');
 if(local){if(local.storageVersion!==2||!Array.isArray(local.blocks)||!Array.isArray(local.artifacts))throw new Error('Invalid project records');for(const a of local.artifacts){safeName(a.file);if(a.file.includes('/')||!files.has(('.isp/artifacts/'+a.file).toLowerCase()))throw new Error('Missing or unsafe artifact file');}}
 const requests=await json('.isp/viewer/requests.json');
 if(requests){if(!Array.isArray(requests))throw new Error('Invalid Viewer requests');for(const r of requests)for(const crop of [...(r.crops||[]),...(r.result?[r.result]:[])]){for(const value of [Object.values(crop.paths||{}),...(crop.regions||[]).map(region=>Object.values(region.paths||{}))].flat()){safeName(value);if(!value.startsWith('.isp/viewer/results/')||!files.has(value.toLowerCase()))throw new Error('Missing or unsafe crop file');}}}
 const tracking=await json('.isp/tracking.json');
 if(tracking&&(tracking.schemaVersion!==1||!Array.isArray(tracking.attempts)||!Array.isArray(tracking.checkpoints)))throw new Error('Invalid work tracking records');
}
async function restoreHistory(project,stage,history,files){
 if(history.head!==null&&!/^[a-f0-9]{40,64}$/.test(history.head))throw new Error('Invalid Git history');
 if(!history.head&&!history.branch)throw new Error('Unborn Git history needs a branch');
 if(history.empty?(history.head!==null||files.has(historyName)):!files.has(historyName))throw new Error('Invalid Git history');
 const references=[];
 for(const [field,prefix] of [['checkpointRefs','refs/isp/checkpoints/'],['recoveryRefs','refs/isp/recovery/']]){
  if(history[field]!==undefined&&!Array.isArray(history[field]))throw new Error('Invalid checkpoint references');
  for(const reference of history[field]||[]){
   if(!reference||typeof reference.ref!=='string'||!reference.ref.startsWith(prefix)||!/^[a-f0-9]{40,64}$/.test(reference.hash))throw new Error('Invalid checkpoint reference');
   await git(project,['check-ref-format',reference.ref]);references.push(reference);
  }
 }
 if(history.empty&&references.length)throw new Error('Empty Git history contains checkpoint references');
 if(history.branch)await git(project,['check-ref-format','--branch',history.branch]);
 await git(project,['-c','init.templateDir=','init','-b','main']);
 if(!history.empty){
  await git(project,['bundle','verify',path.join(stage,historyName)]);
  await git(project,['fetch','--update-head-ok',path.join(stage,historyName),'refs/heads/*:refs/heads/*','refs/tags/*:refs/tags/*','refs/isp/checkpoints/*:refs/isp/checkpoints/*','refs/isp/recovery/*:refs/isp/recovery/*',...(history.head?['HEAD']:[])]);
 }
 if(history.head)await git(project,['cat-file','-e',history.head+'^{commit}']);
 for(const reference of references)if(await git(project,['rev-parse','--verify',reference.ref])!==reference.hash)throw new Error('Git history is missing checkpoint: '+reference.ref);
 if(history.branch)await git(project,['symbolic-ref','HEAD','refs/heads/'+history.branch]);
 else await git(project,['update-ref','--no-deref','HEAD',history.head]);
 if(history.head)await git(project,['reset','--mixed',history.head]);
 if(!history.empty)await fs.unlink(path.join(stage,historyName));
}
async function extractValidatedBundle(input,parent){
 const zip=await openZip(input);let stage,success=false;
 try{
  const entry=zip.entries.find(e=>e.path===metaName);if(!entry||entry.length>4*1024*1024)throw new Error('Missing or oversized ISP bundle manifest');const manifest=JSON.parse((await zip.read(entry)).toString('utf8'));
  if(manifest.format!=='isp-block-maker-bundle'||![1,2].includes(manifest.version)||!Array.isArray(manifest.files)||manifest.files.length!==zip.entries.length-1)throw new Error('Unsupported ISP bundle version or file list');
  const relativeSource=manifest.version===1?'.':manifest.sourceRoot;
  if(!['.','project'].includes(relativeSource))throw new Error('Invalid bundle source root');
  const byName=new Map(zip.entries.map(e=>[e.path,e])),seen=new Set();
  for(const f of manifest.files){safeName(f.path);if(seen.has(f.path.toLowerCase())||f.path===metaName||!byName.has(f.path)||f.size!==byName.get(f.path).length||!/^([a-f0-9]{64})$/.test(f.sha256)||f.path!==historyName&&excluded(f.path))throw new Error('Invalid or forbidden bundle file: '+f.path);seen.add(f.path.toLowerCase());}
  const graphName=relativeSource==='.'?'graph.json':relativeSource+'/graph.json';
  if(!seen.has(graphName))throw new Error('Bundle has no '+graphName);
  if(!manifest.history&&seen.has(historyName))throw new Error('Unexpected Git history file');
  stage=await fs.mkdtemp(path.join(parent,'.isp-unpack-'));
  for(const f of manifest.files){const bytes=await zip.read(byName.get(f.path));if(sha256(bytes)!==f.sha256)throw new Error('Bundle SHA-256 mismatch: '+f.path);const target=path.join(stage,f.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});}
  const project=sourceRoot(stage);
  if(sourceRelative(stage,project)!==relativeSource)throw new Error('Bundle source root does not match workspace layout');
  validateGraph(JSON.parse(await fs.readFile(path.join(project,'graph.json'),'utf8')));
  await validateLocalRecords(stage,seen);
  if(manifest.history)await restoreHistory(project,stage,manifest.history,seen);
  success=true;return {stage,manifest};
 }finally{await zip.close();if(stage&&!success)await fs.rm(stage,{recursive:true,force:true});}
}

export async function inspectBundle(input){
 const {stage,manifest}=await extractValidatedBundle(input,os.tmpdir());
 try{return {name:manifest.name,sourceRoot:manifest.sourceRoot||'.',version:manifest.version,fileCount:manifest.files.length,bytes:manifest.files.reduce((sum,f)=>sum+f.size,0),includeImages:manifest.includeImages!==false,includeViewer:manifest.includeViewer!==false,includeVisualizations:manifest.includeVisualizations!==false,includeData:manifest.includeData!==false,artifactCount:JSON.parse(await fs.readFile(path.join(stage,'.isp/project.json'),'utf8').catch(()=>'{"artifacts":[]}')).artifacts?.length||0,hasGit:!!manifest.history};}
 finally{await fs.rm(stage,{recursive:true,force:true});}
}

const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const within=(parent,child)=>{const relative=path.relative(parent,child);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
async function ordinaryAncestors(target){
 let current=path.parse(target).root;
 for(const part of path.relative(current,target).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  let stat;try{stat=await fs.lstat(current);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Bundle destination must use ordinary folders, not linked paths: '+current);
 }
}
async function snapshotFolder(folder){
 const records=[];
 async function walk(relative=''){
  for(const name of (await fs.readdir(path.join(folder,relative))).sort()){
   const file=relative?relative+'/'+name:name;
   // Shutdown removes discovery; it is not user work and never comes from a bundle.
   if(file==='.isp/connection.json'||/^\.isp\/viewer\/current-view\.png(?:\.tmp)?$/.test(file)||/^(?:project\/)?\.git\/isp-index-[a-f0-9-]+(?:\.lock)?$/.test(file))continue;
   // Reading work tracking creates immutable Git objects and refreshes index caches.
   // Track staging entries semantically below, while HEAD/refs and all source files remain guarded.
   if(/^(?:project\/)?\.git\/(?:objects|index)$/.test(file))continue;
   const stat=await fs.lstat(path.join(folder,file));
   if(stat.isDirectory()&&!stat.isSymbolicLink()){records.push([file,'directory']);await walk(file);continue;}
   records.push([file,stat.size,stat.mtimeMs,stat.ctimeMs,stat.isSymbolicLink()?'link':'file']);
  }
 }
 await walk();const source=sourceRoot(folder);if(await fs.lstat(path.join(source,'.git')).then(stat=>stat.isDirectory()&&!stat.isSymbolicLink(),()=>false))records.push(['git-staging',await git(source,['ls-files','--stage','-z'])]);return sha256(Buffer.from(JSON.stringify(records)));
}
export async function previewBundleDestination(folder,{mode='new',protectedPaths=[]}={}){
 if(!['new','overwrite'].includes(mode))throw new Error('Choose a new folder or overwrite an existing workspace.');
 if(typeof folder!=='string'||!path.isAbsolute(folder))throw new Error('복원할 폴더의 절대경로를 입력하세요.');
 let destination=path.resolve(folder);await ordinaryAncestors(destination);
 const stat=await fs.lstat(destination).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(stat)destination=normalizeWorkspaceFolder(destination);
 const parent=await fs.realpath(path.dirname(destination));destination=path.join(parent,path.basename(destination));
 if([path.parse(destination).root,os.homedir(),root,...protectedPaths].some(p=>within(destination,path.resolve(p))))throw new Error('프레임워크, 홈 폴더 또는 사용 중인 프로젝트의 상위 폴더는 덮어쓸 수 없습니다.');
 if(mode==='new'){
  if(stat)throw new Error('Destination already exists. 새 폴더 이름을 지정하거나 덮어쓰기를 선택하세요.');
  return {destination,exists:false,backupRequired:false,snapshot:sha256(Buffer.from('new:'+destination))};
 }
 if(!stat)throw new Error('덮어쓸 기존 ISP workspace 폴더를 선택하세요.');
 const source=sourceRoot(destination),graphFile=path.join(source,'graph.json');
 if((await fs.lstat(graphFile)).isSymbolicLink())throw new Error('Linked graph files cannot be overwritten.');
 const graph=validateGraph(JSON.parse(await fs.readFile(graphFile,'utf8')));
 const recordsFile=path.join(destination,'.isp/project.json');
 if((await fs.lstat(recordsFile).catch(()=>null))?.isSymbolicLink())throw new Error('Linked workspace records cannot be overwritten.');
 // A valid graph is required even for legacy workspaces. Arbitrary folders are never replaceable.
 return {destination,exists:true,name:graph.name,backupRequired:true,snapshot:await snapshotFolder(destination)};
}
export function bundleBackupPath(destination){return destination+'.backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+Math.random().toString(16).slice(2,8);}
async function renameFolder(from,to){
 for(let attempt=0;;attempt++)try{await fs.rename(from,to);return;}catch(error){if(attempt>=5||!['EBUSY','EPERM','EACCES'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));}
}
async function rebaseSavedViews(stage,destination){
 const migration=path.join(stage,'.isp/layout-migrated.json');
 if(await fs.stat(migration).then(()=>true,()=>false)){const record=JSON.parse(await fs.readFile(migration,'utf8'));if(samePath(record.workspace||stage,stage)){record.workspace=destination;await fs.writeFile(migration,JSON.stringify(record,null,2)+'\n');}}
 const views=path.join(stage,'.isp/viewer/views.json');if(!await fs.stat(views).then(()=>true,()=>false))return;
 const list=JSON.parse(await fs.readFile(views,'utf8'));if(!Array.isArray(list))throw new Error('Invalid saved views');
 for(const v of list){if(!/^[a-f0-9-]{36}$/i.test(v.id))throw new Error('Invalid saved view ID');v.paths={image:path.join(destination,'.isp/viewer/views',v.id,'view.png'),metadata:path.join(destination,'.isp/viewer/views',v.id,'metadata.json')};await fs.writeFile(path.join(stage,'.isp/viewer/views',v.id,'metadata.json'),JSON.stringify(v));}
 await fs.writeFile(views,JSON.stringify(list));
}

/** Validate and prepare everything before swapping folders. Failed replacement restores the original. */
const importingDestinations=new Set();
export async function unpackBundle(input,folder,options={}){
 const mode=options.overwrite?'overwrite':options.mode||'new';
 const preview=await previewBundleDestination(path.resolve(folder),{mode,protectedPaths:options.protectedPaths});
 const destination=preview.destination,parent=path.dirname(destination);
 if(options.destinationSnapshot&&options.destinationSnapshot!==preview.snapshot)throw new Error('복원할 폴더가 변경되었습니다. 다시 확인하세요.');
 const lock=process.platform==='win32'?destination.toLowerCase():destination;
 if([...importingDestinations].some(active=>within(active,lock)||within(lock,active)))throw new Error('이 폴더는 이미 번들 복원 중입니다. 완료 후 다시 확인하세요.');
 importingDestinations.add(lock);
 const {stage,manifest}=await extractValidatedBundle(input,parent).catch(error=>{importingDestinations.delete(lock);throw error;});let backupPath=null,backupMade=false,installed=false,context,prepared=false,failed=false;
 try{
  if(options.prepare)await options.prepare(stage,destination);
  await rebaseSavedViews(stage,destination);
  const latest=await previewBundleDestination(destination,{mode,protectedPaths:options.protectedPaths});
  if(latest.snapshot!==preview.snapshot)throw new Error('복원할 폴더가 변경되었습니다. 다시 확인하세요.');
  if(mode==='overwrite'){
   backupPath=options.backupPath||bundleBackupPath(destination);
   if(!samePath(path.dirname(backupPath),parent)||!path.basename(backupPath).startsWith(path.basename(destination)+'.backup-'))throw new Error('Invalid backup folder.');
   if(await fs.lstat(backupPath).then(()=>true,()=>false))throw new Error('Backup folder already exists. Refresh the preview.');
   if(options.beforeReplace){context=await options.beforeReplace(destination);prepared=true;}
   else await assertWorkspaceStopped(destination);
   const stopped=await previewBundleDestination(destination,{mode,protectedPaths:options.protectedPaths});
   if(stopped.snapshot!==preview.snapshot)throw new Error('종료 중 작업 내용이 변경되었습니다. 다시 확인한 뒤 복원하세요.');
   await renameFolder(destination,backupPath);backupMade=true;
   await renameFolder(stage,destination);installed=true;
  }else{
   // Exclusive mkdir prevents a concurrent import from being replaced by rename.
   await fs.mkdir(destination);installed=true;
   for(const child of await fs.readdir(stage))await fs.rename(path.join(stage,child),path.join(destination,child));
  }
  if(options.finalize)await options.finalize(destination);
  const result={workspace:destination,manifest,...(backupPath?{backupPath}:{})};
  if(options.afterReplace&&mode==='overwrite')await options.afterReplace(result,context);
  return result;
 }catch(error){
  failed=true;let failure=error;
  try{
   if(installed)await fs.rm(destination,{recursive:true,force:true,maxRetries:5,retryDelay:200});
   if(backupMade){await renameFolder(backupPath,destination);backupMade=false;backupPath=null;}
  }catch(rollbackError){
   failure=new Error(`${error.message} 복원 롤백을 완료하지 못했습니다: ${rollbackError.message}${backupMade?' 원본 백업: '+backupPath:''}`,{cause:error});
   if(backupMade)failure.backupPath=backupPath;
  }finally{
   if(prepared&&options.replaceFailed)try{await options.replaceFailed(context,failure);}catch(reopenError){failure.message+=' 서버 재연결 실패: '+reopenError.message;}
  }
  throw failure;
 }finally{try{await fs.rm(stage,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch(error){if(!failed)throw error;}finally{importingDestinations.delete(lock);}}
}

export async function runningBundleWorkspace(workspace){
 let connection;try{connection=JSON.parse(await fs.readFile(path.join(workspace,'.isp/connection.json'),'utf8'));}catch{return null;}
 let url;try{url=new URL(connection.url);}catch{return null;}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/')throw new Error('Invalid local workspace server URL.');
 try{const health=await fetch(new URL('/health',url),{redirect:'error',signal:AbortSignal.timeout(1200)}).then(r=>r.json());if(health.app==='ISPBlockMaker'&&samePath(health.workspace,workspace))return {url:url.origin,token:connection.token,instance:health.instance,pid:health.pid};}
 catch{}return null;
}
export async function assertWorkspaceStopped(workspace){if(await runningBundleWorkspace(workspace))throw new Error('해당 workspace 서버가 실행 중입니다. 서버를 종료한 뒤 다시 복원하거나 UI에서 덮어쓰기를 사용하세요.');}
