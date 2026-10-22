import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {openWorkspaceServer,findWorkspaceServer} from './workspace-open.mjs';
import {normalizeWorkspaceFolder} from './project-layout.mjs';
import {installHubAgentApi} from './hub-agent-api.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const hubStateRoot=()=>process.env.ISP_STATE_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'ISPBlockMaker','state');
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const key=p=>process.platform==='win32'?p.toLowerCase():p;
const localUrl=value=>{const u=new URL(value);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password)throw Error('Invalid local address');return u.origin;};
async function health(url){return fetch(localUrl(url)+'/health',{redirect:'error',signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():null).catch(()=>null);}
async function portClosed(url){const address=new URL(localUrl(url));return new Promise(resolve=>{const socket=net.connect({host:address.hostname,port:Number(address.port)});const done=value=>{socket.destroy();resolve(value);};socket.setTimeout(1000,()=>done(false));socket.once('connect',()=>done(false));socket.once('error',error=>done(error.code==='ECONNREFUSED'));});}

export async function createHub({stateRoot=hubStateRoot(),frameworkRoot=root,port=4309}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid hub port');
 fs.mkdirSync(stateRoot,{recursive:true});
 const registryFile=path.join(stateRoot,'hub-projects.json'),discovery=path.join(stateRoot,'hub.json');
 let projects=read(registryFile)||[],selected=null,selection=0,stopping=false,openingCount=0;
 const token=crypto.randomBytes(32).toString('hex'),instance=crypto.randomUUID();
 const app=express(),server=http.createServer(app);let url,agentApi;
 const persist=()=>{fs.writeFileSync(registryFile+'.tmp',JSON.stringify(projects));fs.renameSync(registryFile+'.tmp',registryFile);};
 const remember=folder=>{const canonical=normalizeWorkspaceFolder(folder);let item=projects.find(p=>key(p.path)===key(canonical));if(!item){item={id:crypto.randomUUID(),path:canonical,lastOpened:null};projects.push(item);persist();}return item;};
 function discover(){
  for(const entry of fs.readdirSync(stateRoot,{withFileTypes:true}).filter(e=>e.isDirectory())){
   for(const file of ['connection.json','active-workspace.json']){const data=read(path.join(stateRoot,entry.name,file));const folder=data?.workspace||data?.path;if(folder)try{remember(folder);}catch{}}
  }
 }
 async function list(){discover();return Promise.all(projects.map(async item=>{
  let address=null,info=null;try{address=await findWorkspaceServer(item.path);if(address)info=await health(address);}catch{}
  return {...item,name:path.basename(item.path),running:!!info,url:info?address:null,instance:info?.instance||null};
 }));}
 async function open(folder){openingCount++;try{const item=remember(folder);const result=await openWorkspaceServer(frameworkRoot,item.path);item.lastOpened=new Date().toISOString();persist();selected=item.id;selection++;return {...result,id:item.id,selection};}finally{openingCount--;}}
 const closeHub=()=>{agentApi.close();if(read(discovery)?.instance===instance)fs.unlinkSync(discovery);server.close();server.closeAllConnections();};
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  const origin=new URL(url).origin;
  if(req.headers.host!==new URL(url).host||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'Local hub requests only'});
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next();
 });
 app.get('/health',(req,res)=>res.json({app:'ISPBlockMakerHub',instance,pid:process.pid,root:frameworkRoot,agentGateway:1}));
 app.get('/api/bootstrap',(req,res)=>res.json({token,instance}));
 app.use('/api',(req,res,next)=>(req.path.startsWith('/agent/v1/')?agentApi.access.authorized(req):req.headers.authorization===`Bearer ${token}`)?next():res.status(401).json({error:'Missing or invalid hub credential'}));
 app.use('/api',express.json({limit:'128kb'}));
 app.use('/api',(req,res,next)=>stopping&&req.method!=='GET'?res.status(409).json({error:'전체 서버 종료 중입니다. 완료 후 다시 실행하세요.'}):next());
 agentApi=installHubAgentApi(app,{stateRoot,list,url:()=>url});
 app.get('/api/projects',async(req,res)=>res.json({projects:await list(),selected,selection}));
 app.post('/api/shutdown',(req,res)=>{
  if(req.body.instance!==instance)return res.status(409).json({error:'Hub instance changed'});
  stopping=true;res.json({stopping:true});
  setTimeout(closeHub,150);
 });
 app.post('/api/shutdown-all',async(req,res)=>{
  if(req.body.instance!==instance)return res.status(409).json({error:'중앙 서버가 바뀌었습니다. 다시 확인하세요.'});
  if(openingCount)return res.status(409).json({error:'서버 시작이 진행 중입니다. 완료 후 다시 시도하세요.'});
  stopping=true;let complete=false;
  try{
   const live=(await list()).filter(p=>p.running);
   const expected=req.body.servers;
   if(!Array.isArray(expected)||expected.length!==live.length||new Set(expected.map(p=>p?.id)).size!==live.length||live.some(p=>!expected.some(e=>e?.id===p.id&&e?.instance===p.instance)))return res.status(409).json({error:'실행 중인 서버 목록이 바뀌었습니다. 새 목록을 확인하고 다시 종료하세요.'});
   const results=await Promise.all(live.map(async item=>{
    try{
     const current=await health(item.url);if(!current||current.instance!==item.instance)throw Error('서버가 변경되었습니다.');
     const boot=await fetch(item.url+'/api/bootstrap',{redirect:'error',signal:AbortSignal.timeout(2000)}).then(r=>r.json());
     const response=await fetch(item.url+'/api/shutdown',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+boot.token,'Content-Type':'application/json'},body:JSON.stringify({instance:item.instance}),signal:AbortSignal.timeout(5000)});
     if(!response.ok)throw Error('종료 요청이 거절되었습니다.');
     const deadline=Date.now()+15000;
     while(Date.now()<deadline){await new Promise(r=>setTimeout(r,150));const remaining=await health(item.url);if(!remaining&&await portClosed(item.url))return {id:item.id,name:item.name,stopped:true};if(remaining&&remaining.instance!==item.instance)throw Error('다른 서버로 교체되었습니다.');}
     throw Error('종료 확인 시간이 초과되었습니다.');
    }catch(error){return {id:item.id,name:item.name,stopped:false,error:error.message};}
   }));
   const failed=results.filter(p=>!p.stopped);
   if(failed.length)return res.status(409).json({error:'종료하지 못한 서버: '+failed.map(p=>p.name+' ('+p.error+')').join(', '),results});
   complete=true;res.json({stopping:true,results});setTimeout(closeHub,150);
  }finally{if(!complete)stopping=false;}
 });
 app.post('/api/open',async(req,res)=>{if(typeof req.body.path!=='string')throw Error('Choose a folder');res.json(await open(req.body.path));});
 app.post('/api/manager/open',(_req,res)=>{selected=null;selection++;res.json({selection});});
 app.post('/api/projects/:id/stop',async(req,res)=>{
  const item=projects.find(p=>p.id===req.params.id);if(!item) return res.status(404).json({error:'Project not found'});
  const address=await findWorkspaceServer(item.path);if(!address)return res.json({stopped:true});
  const current=await health(address);if(!current||current.instance!==req.body.instance)return res.status(409).json({error:'서버가 바뀌었습니다. 목록을 새로 확인하세요.'});
  const boot=await fetch(address+'/api/bootstrap',{redirect:'error',signal:AbortSignal.timeout(2000)}).then(r=>r.json());
  const response=await fetch(address+'/api/shutdown',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${boot.token}`,'Content-Type':'application/json'},body:JSON.stringify({instance:current.instance}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('서버를 종료하지 못했습니다.');
  res.json({stopped:true});
 });
 app.get('/api/folders',(req,res)=>{const folder=fs.realpathSync(typeof req.query.path==='string'?req.query.path:os.homedir());res.json({path:folder,parent:path.dirname(folder),directories:fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isDirectory()&&!['.git','.isp','node_modules'].includes(e.name)).map(e=>({name:e.name,path:path.join(folder,e.name)}))});});
 app.get('/',(req,res)=>res.status(410).type('text').send('ISP server management is available in the Windows launcher. Open the workspace server URL for the web UI.'));
 app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown hub API endpoint'}));
 app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.message}));
 for(let candidate=port;candidate<=Math.min(port+20,65535);candidate++){
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(candidate,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});break;}catch(e){if(e.code!=='EADDRINUSE'||candidate===Math.min(port+20,65535))throw e;}
 }
 url=`http://127.0.0.1:${server.address().port}`;
 fs.writeFileSync(discovery,JSON.stringify({url,token,instance,pid:process.pid}),{mode:0o600});
 return {url,token,server,close:async()=>{agentApi.close();if(read(discovery)?.instance===instance)fs.unlinkSync(discovery);await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}};
}

export async function openInHub(folder){
 const base=hubStateRoot();fs.mkdirSync(base,{recursive:true});const discovery=path.join(base,'hub.json'),lock=path.join(base,'hub-start.lock');
 const find=async()=>{const record=read(discovery);if(!record)return null;try{const h=await health(record.url);return h?.app==='ISPBlockMakerHub'&&h.instance===record.instance?{...record,root:h.root}:null;}catch{return null;}};
 let record=await find();
 if(!record){
  let owned=false;
  for(let i=0;i<200;i++){
   try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});owned=true;break;}catch(e){if(e.code!=='EEXIST')throw e;const holder=read(lock);if(holder?.pid){try{process.kill(holder.pid,0);}catch(error){if(error.code==='ESRCH'){fs.unlinkSync(lock);continue;}}}await new Promise(r=>setTimeout(r,300));record=await find();if(record)break;}
  }
  if(owned)try{
   record=await find();
   if(!record){const logs=path.join(base,'hub.log'),out=fs.openSync(logs,'a');let child;try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--serve'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,out]});}finally{fs.closeSync(out);}await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();for(let i=0;i<150;i++){record=await find();if(record)break;if(child.exitCode!==null)throw Error('Hub startup failed. See '+logs);await new Promise(r=>setTimeout(r,200));}}
  }finally{fs.unlinkSync(lock);}
  if(!record)throw Error('Hub startup timed out');
 }
 if(record.root&&key(path.resolve(record.root))!==key(root))throw Error('다른 설치 버전의 서버 관리 창이 실행 중입니다. 기존 Windows 서버 관리 창을 닫은 뒤 다시 실행하세요. 프로젝트 서버는 유지됩니다.');
 const response=await fetch(record.url+(folder?'/api/open':'/api/manager/open'),{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${record.token}`,'Content-Type':'application/json'},body:JSON.stringify(folder?{path:path.resolve(folder),launch:false}:{}),signal:AbortSignal.timeout(120000)});
 const result=await response.json();if(!response.ok)throw Error(result.error);

 return {url:record.url,workspace:result.workspace};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv.includes('--serve')){
 const hub=await createHub({port:Number(process.env.ISP_HUB_PORT||4309)});console.log(`ISP project hub → ${hub.url}`);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>hub.close().then(()=>process.exit(0)));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv.includes('--open')){
 try{console.log(JSON.stringify(await openInHub(process.env.ISP_MANAGER_ONLY==='1'?null:process.env.ISP_MANAGER_FOLDER||process.cwd())));}catch(e){console.error(e.message);process.exitCode=1;}
}
