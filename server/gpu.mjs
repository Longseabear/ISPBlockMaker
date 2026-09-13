import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
const uniform=z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).refine(v=>!v.startsWith('gl_')&&!['u_image','u_resolution'].includes(v));
export const gpuSchema=z.object({version:z.literal(1),id:z.string().regex(/^[a-zA-Z0-9_-]+$/).refine(v=>v!=='builtin-preview','Reserved extension id'),name:z.string().min(1).max(100),description:z.string().max(4000),blockId:z.string().optional(),reference:z.object({shaderSha256:z.string().regex(/^[a-f0-9]{64}$/i),sources:z.array(z.object({path:z.string().min(1).max(1000),sha256:z.string().regex(/^[a-f0-9]{64}$/i)})).min(1).max(30)}).optional(),fragment:z.string().min(1).max(100000),parameters:z.array(z.object({name:uniform,label:z.string().max(100),min:z.number().finite(),max:z.number().finite(),step:z.number().positive(),default:z.number().finite(),blockId:z.string().optional(),parameter:z.string().optional()}).refine(p=>p.min<p.max&&p.default>=p.min&&p.default<=p.max&&Boolean(p.blockId)===Boolean(p.parameter))).max(32)}).refine(x=>new Set(x.parameters.map(p=>p.name)).size===x.parameters.length,'Duplicate uniform');
export async function gpuExtensions(workspace){
 const root=await fs.realpath(workspace),folder=path.join(root,'extensions','gpu');let names;
 try{names=await fs.readdir(folder);}catch(e){if(e.code==='ENOENT')return {extensions:[],errors:[]};throw e;}
 const extensions=[],errors=[];
 for(const name of names.filter(n=>n.endsWith('.json')).sort().slice(0,50)){
  try{const file=await fs.realpath(path.join(folder,name));const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Extension outside workspace');if((await fs.stat(file)).size>150000)throw new Error('Extension too large');const raw=await fs.readFile(file,'utf8');const value=gpuSchema.parse(JSON.parse(raw));if(extensions.some(e=>e.id===value.id))throw new Error('Duplicate extension id');extensions.push({...value,sync:await checkGpuReference(root,value),hash:crypto.createHash('sha256').update(raw).digest('hex'),file:path.relative(root,file)});}catch(e){errors.push({file:name,error:e.message});}
 }
 return {extensions,errors};
}

export async function checkGpuReference(workspace, extension) {
 const reference=extension.reference;
 if(!reference)return {status:'unrecorded',details:['기준 소스 해시가 없습니다. CPU/GPU 대응을 확인한 뒤 기준을 기록하세요.']};
 const root=await fs.realpath(workspace),details=[];
 let unavailable=false;
 if(crypto.createHash('sha256').update(extension.fragment).digest('hex')!==reference.shaderSha256.toLowerCase())details.push('GPU 셰이더가 기준 이후 변경되었습니다.');
 for(const source of reference.sources){
  try {
   const file=await fs.realpath(path.resolve(root,source.path)),relative=path.relative(root,file);
   if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('프로젝트 밖의 경로');
   const stat=await fs.stat(file);if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('2MB 이하 소스 파일만 지원');
   const current=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
   if(current!==source.sha256.toLowerCase())details.push(`${source.path}: 기준 이후 변경됨`);
  }catch{unavailable=true;details.push(`${source.path}: 파일 또는 경로를 확인할 수 없음`);}
 }
 return {status:unavailable?'unavailable':details.length?'changed':'match',details};
}
