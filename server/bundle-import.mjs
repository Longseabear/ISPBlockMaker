import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {unpackBundle,inspectBundle,previewBundleDestination,bundleBackupPath,runningBundleWorkspace} from './bundles.mjs';
import {openWorkspace} from './workspaces.mjs';
import {MAX_TOTAL} from './bundle-zip.mjs';
export async function startBundleWorkspace(root,workspace){
 const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const url=`http://127.0.0.1:${port}`,child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,ISP_WORKSPACE:workspace,PORT:String(port)},detached:true,stdio:'ignore',windowsHide:true});
 try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('프로젝트 서버가 종료되었습니다.');try{const h=await fetch(url+'/health',{signal:AbortSignal.timeout(500)}).then(r=>r.json());if(h.pid===child.pid&&path.resolve(h.workspace)===workspace){child.unref();return url;}}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('서버 시작 시간이 초과되었습니다. 선택한 폴더에서 isp-block-maker . 로 다시 실행하세요.');}catch(e){child.kill();throw e;}
}
export function installBundleImport(app,{root,start=startBundleWorkspace,current=()=>null,beforeReplace,afterReplace,replaceFailed}){
 const restored=new Map(),uploads=new Map(),ttl=30*60*1000;
 const same=(a,b)=>!!a&&!!b&&(process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b));
 function cleanup(){for(const [key,value] of uploads)if(!value.busy&&Date.now()-value.time>ttl){fs.rmSync(value.temp,{recursive:true,force:true});uploads.delete(key);}for(const [key,value] of restored)if(Date.now()-value.time>ttl)restored.delete(key);}
 const expiry=setInterval(cleanup,60000);expiry.unref();
 function upload(token){cleanup();const item=uploads.get(token);if(!item)throw new Error('번들 미리보기가 만료되었습니다. 파일을 다시 선택하세요.');if(item.busy)throw new Error('번들 복원이 진행 중입니다.');return item;}
 async function receive(req){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-bundle-upload-')),input=path.join(temp,'input.bundle');let bytes=0;
  try{const limit=new Transform({transform(chunk,enc,cb){bytes+=chunk.length;if(bytes>MAX_TOTAL+8*1024*1024)cb(new Error('번들은 최대 2 GiB입니다.'));else cb(null,chunk);}});await pipeline(req,limit,fs.createWriteStream(input,{flags:'wx'}));return {temp,input};}
  catch(error){fs.rmSync(temp,{recursive:true,force:true});throw error;}
 }
 function remember(result){const id=crypto.randomUUID();restored.set(id,{workspace:result.workspace,time:Date.now(),opening:false,url:null});return {id,workspace:result.workspace,name:result.manifest.name,includeImages:result.manifest.includeImages,...(result.backupPath?{backupPath:result.backupPath}:{})};}
 async function stopTarget(destination){
  if(same(current(),destination)){
   if(!beforeReplace)throw new Error('현재 workspace 서버를 종료한 뒤 다시 시도하세요.');
   return {current:true,value:await beforeReplace(destination)};
  }
  const running=await runningBundleWorkspace(destination);
  if(!running)return {current:false};
  const response=await fetch(running.url+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+running.token},body:JSON.stringify({instance:running.instance}),redirect:'error',signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error('대상 workspace 서버를 안전하게 종료할 수 없습니다. 직접 종료한 뒤 다시 확인하세요.');
  for(let i=0;i<100;i++){
   await new Promise(resolve=>setTimeout(resolve,100));
   try{const health=await fetch(running.url+'/health',{redirect:'error',signal:AbortSignal.timeout(300)}).then(r=>r.json());if(health.instance!==running.instance)throw new Error('대상 서버가 다시 시작되었습니다. 복원을 취소했습니다.');}
   catch(error){if(error.message==='대상 서버가 다시 시작되었습니다. 복원을 취소했습니다.')throw error;return {current:false};}
  }
  throw new Error('대상 workspace 서버 종료 시간이 초과되었습니다. 원본 폴더는 유지됩니다.');
 }
 const restoreOptions=extra=>({...extra,protectedPaths:[root],prepare:stage=>openWorkspace(stage,root),finalize:destination=>openWorkspace(destination,root),beforeReplace:stopTarget,afterReplace:async(result,context)=>{if(context?.current&&afterReplace)await afterReplace(result,context.value);},replaceFailed:async(context,error)=>{if(context?.current&&replaceFailed)await replaceFailed(context.value,error);}});
 app.post('/api/bundle/import/preview',async(req,res)=>{
  if(!req.is('application/octet-stream'))return res.status(415).json({error:'번들 파일을 선택하세요.'});cleanup();
  if(uploads.size>=4)return res.status(409).json({error:'열려 있는 번들 미리보기를 닫은 뒤 다시 선택하세요.'});
  const file=await receive(req);
  try{const info=await inspectBundle(file.input),token=crypto.randomUUID();uploads.set(token,{...file,time:Date.now(),busy:false,info,destinations:new Map()});res.json({token,...info});}
  catch(error){fs.rmSync(file.temp,{recursive:true,force:true});throw error;}
 });
 app.delete('/api/bundle/import/preview/:token',(req,res)=>{const item=uploads.get(req.params.token);if(item?.busy)return res.status(409).json({error:'복원 중에는 닫을 수 없습니다.'});if(item){fs.rmSync(item.temp,{recursive:true,force:true});uploads.delete(req.params.token);}res.json({deleted:true});});
 app.post('/api/bundle/import/destination',async(req,res)=>{
  const item=upload(req.body?.token),mode=req.body?.mode;
  const preview=await previewBundleDestination(req.body?.destination,{mode,protectedPaths:[root]}),running=preview.exists?await runningBundleWorkspace(preview.destination):null;
  const active=current();if(active&&!same(active,preview.destination)){const relative=path.relative(preview.destination,active);if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw new Error('현재 workspace의 상위 폴더에는 복원할 수 없습니다.');}
  const detail={...preview,...(preview.exists?{backupPath:bundleBackupPath(preview.destination)}:{}),serverRunning:!!running||same(current(),preview.destination),currentWorkspace:same(current(),preview.destination)};
  item.destinations.set(mode+':'+detail.destination,{...detail,mode});item.time=Date.now();res.json(detail);
 });
 app.post('/api/bundle/import/confirm',async(req,res)=>{
  const item=upload(req.body?.token),mode=req.body?.mode,destination=req.body?.destination;
  if(typeof destination!=='string'||!path.isAbsolute(destination))throw new Error('복원할 폴더를 다시 확인하세요.');
  const preview=item.destinations.get(mode+':'+path.resolve(destination));
  if(!preview||req.body?.destinationSnapshot!==preview.snapshot)return res.status(409).json({error:'복원할 폴더를 먼저 확인하세요.'});
  item.busy=true;
  try{const result=await unpackBundle(item.input,preview.destination,restoreOptions({mode,destinationSnapshot:preview.snapshot,backupPath:preview.backupPath}));res.status(201).json(remember(result));uploads.delete(req.body.token);fs.rmSync(item.temp,{recursive:true,force:true});}
  finally{item.busy=false;}
 });
 app.post('/api/bundle/import',async(req,res)=>{
  if(!req.is('application/octet-stream'))return res.status(415).json({error:'번들 파일을 선택하세요.'});
  const destination=decodeURIComponent(String(req.headers['x-bundle-destination']||''));if(!path.isAbsolute(destination))throw new Error('복원할 새 폴더의 절대경로를 입력하세요.');
  if(fs.existsSync(destination))return res.status(409).json({error:'이미 존재하는 폴더입니다. 새 폴더 이름을 지정하세요.'});
  const file=await receive(req);
  try{const result=await unpackBundle(file.input,destination,restoreOptions({mode:'new'}));cleanup();res.status(201).json(remember(result));}
  finally{fs.rmSync(file.temp,{recursive:true,force:true});}
 });
 app.post('/api/bundle/open',async(req,res)=>{
  const item=restored.get(req.body?.id);if(!item||Date.now()-item.time>30*60*1000)return res.status(404).json({error:'복원 기록이 만료됐습니다. 복원된 폴더에서 isp-block-maker . 로 여세요.'});if(item.opening)return res.status(409).json({error:'프로젝트 서버를 시작하고 있습니다.'});const active=await runningBundleWorkspace(item.workspace);if(active)return res.json({url:active.url});if(item.url){try{const h=await fetch(item.url+'/health',{signal:AbortSignal.timeout(1000)}).then(r=>r.json());if(path.resolve(h.workspace)===item.workspace)return res.json({url:item.url});}catch{}item.url=null;}item.opening=true;try{item.url=await start(root,item.workspace);res.json({url:item.url});}finally{item.opening=false;}
 });
}
