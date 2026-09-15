import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {unpackBundle} from './bundles.mjs';
import {openWorkspace} from './workspaces.mjs';
import {MAX_TOTAL} from './bundle-zip.mjs';
export async function startBundleWorkspace(root,workspace){
 const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const url=`http://127.0.0.1:${port}`,child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,ISP_WORKSPACE:workspace,PORT:String(port)},detached:true,stdio:'ignore',windowsHide:true});
 try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('복원된 프로젝트 서버가 종료되었습니다.');try{const h=await fetch(url+'/health',{signal:AbortSignal.timeout(500)}).then(r=>r.json());if(h.pid===child.pid&&path.resolve(h.workspace)===workspace){child.unref();return url;}}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('서버 시작 시간이 초과되었습니다. 복원된 폴더에서 isp-block-maker . 로 다시 실행하세요.');}catch(e){child.kill();throw e;}
}
export function installBundleImport(app,{root,start=startBundleWorkspace}){
 const restored=new Map();
 app.post('/api/bundle/import',async(req,res)=>{
  if(!req.is('application/octet-stream'))return res.status(415).json({error:'번들 파일을 선택하세요.'});
  const destination=decodeURIComponent(String(req.headers['x-bundle-destination']||''));if(!path.isAbsolute(destination))throw new Error('복원할 새 폴더의 절대경로를 입력하세요.');
  if(fs.existsSync(destination))return res.status(409).json({error:'이미 존재하는 폴더입니다. 새 폴더 이름을 지정하세요.'});
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-bundle-upload-'));let bytes=0;
  try{const input=path.join(temp,'input.bundle');const limit=new Transform({transform(chunk,enc,cb){bytes+=chunk.length;if(bytes>MAX_TOTAL+8*1024*1024)cb(new Error('번들은 최대 2 GiB입니다.'));else cb(null,chunk);}});await pipeline(req,limit,fs.createWriteStream(input,{flags:'wx'}));const result=await unpackBundle(input,destination);openWorkspace(result.workspace,root);const id=crypto.randomUUID();for(const [key,value] of restored)if(Date.now()-value.time>30*60*1000)restored.delete(key);restored.set(id,{workspace:result.workspace,time:Date.now(),opening:false,url:null});res.status(201).json({id,workspace:result.workspace,name:result.manifest.name,includeImages:result.manifest.includeImages});}
  finally{fs.rmSync(temp,{recursive:true,force:true});}
 });
 app.post('/api/bundle/open',async(req,res)=>{
  const item=restored.get(req.body?.id);if(!item||Date.now()-item.time>30*60*1000)return res.status(404).json({error:'복원 기록이 만료됐습니다. 복원된 폴더에서 isp-block-maker . 로 여세요.'});if(item.opening)return res.status(409).json({error:'프로젝트 서버를 시작하고 있습니다.'});if(item.url){try{const h=await fetch(item.url+'/health',{signal:AbortSignal.timeout(1000)}).then(r=>r.json());if(path.resolve(h.workspace)===item.workspace)return res.json({url:item.url});}catch{}item.url=null;}item.opening=true;try{item.url=await start(root,item.workspace);res.json({url:item.url});}finally{item.opening=false;}
 });
}
