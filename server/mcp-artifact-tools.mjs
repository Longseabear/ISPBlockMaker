import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {safeGraphPath} from './graph-storage.mjs';

export function readArtifactFile(workspace,file){
 const relative=path.relative(workspace,path.resolve(workspace,file)).replaceAll('\\','/');
 const resolved=safeGraphPath(workspace,relative),stat=fs.statSync(resolved);
 if(!stat.isFile()||stat.size<1||stat.size>10*1024*1024)throw Error('Artifact must be a regular workspace file of 1 byte to 10 MiB');
 const kind=({'.html':'html','.htm':'html','.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'})[path.extname(resolved).toLowerCase()];
 if(!kind)throw Error('Supported report files: HTML, PNG, JPEG, WebP');
 const bytes=fs.readFileSync(resolved);if(bytes.length>10*1024*1024)throw Error('Artifact exceeds 10 MiB');
 return {kind,content:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),path:relative};
}

export function registerArtifactTools(tool,{api,mutate,readFile,artifacts}){
 tool('list_reports','List registered report metadata, without loading HTML or image bytes.',{block_id:z.string().optional(),offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(50).default(20)},({block_id,offset,limit})=>{
  const values=artifacts().filter(a=>!block_id||a.blockId===block_id);return {total:values.length,artifacts:values.slice(offset,offset+limit)};
 });
 const request_id=z.string().uuid(),file=z.string().min(1).max(4096);
 tool('register_report','Register an existing workspace HTML/image file in Visualizations. File bytes are read by the server and never placed in model context. Use present_report afterwards to display it.',{request_id,file,title:z.string().min(1).max(150),block_id:z.string().min(1).max(80),revision:z.number().int().positive(),run_id:z.string().max(100).optional()},input=>mutate('register_report',input,async()=>{
  const data=readFile(input.file);
  return api('POST','/api/artifacts',{title:input.title,blockId:input.block_id,revision:input.revision,runId:input.run_id,kind:data.kind,content:data.content,metadata:{registrationSource:{path:data.path,sha256:data.sha256}}});
 }),false);
 tool('update_report','Replace a registered report from a workspace file while retaining its identity. Supply the expected file version from list_reports to reject stale edits.',{request_id,file,artifact_id:z.string().uuid(),expected_file:z.string().min(1).max(200),title:z.string().min(1).max(150).optional()},input=>mutate('update_report',input,async()=>{
  const data=readFile(input.file);
  return api('PATCH',`/api/artifacts/${input.artifact_id}`,{expectedFile:input.expected_file,kind:data.kind,content:data.content,...(input.title===undefined?{}:{title:input.title})});
 }),false);
 tool('delete_reports','Remove explicitly selected registered reports and their managed copies. Original source files remain.',{request_id,artifact_ids:z.array(z.string().uuid()).min(1).max(100)},input=>mutate('delete_reports',input,()=>api('DELETE','/api/artifacts',{ids:input.artifact_ids})),false,true);
}
