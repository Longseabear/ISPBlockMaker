import fs from 'node:fs';
import path from 'node:path';
import {startBundleWorkspace} from './bundle-import.mjs';
const opening=new Map();
async function runningWorkspace(workspace){
 try{
  const record=JSON.parse(fs.readFileSync(path.join(workspace,'.isp/connection.json'),'utf8'));
  const url=new URL(record.url);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)return null;
  const response=await fetch(url.origin+'/health',{redirect:'error',signal:AbortSignal.timeout(1500)});
  const health=await response.json();
  if(response.ok&&health.app==='ISPBlockMaker'&&fs.realpathSync(health.workspace)===workspace)return url.origin;
 }catch{}
 return null;
}
export async function openWorkspaceServer(root,folder){
 const workspace=fs.realpathSync(folder);
 if(!fs.statSync(workspace).isDirectory())throw new Error('작업 폴더를 선택하세요.');
 const key=process.platform==='win32'?workspace.toLowerCase():workspace;
 if(opening.has(key))return opening.get(key);
 const pending=(async()=>({workspace,url:await runningWorkspace(workspace)||await startBundleWorkspace(root,workspace)}))();
 opening.set(key,pending);
 try{return await pending;}finally{opening.delete(key);}
}
