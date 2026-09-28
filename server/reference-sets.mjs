import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import express from 'express';
import {z} from 'zod';
import {sourceRoot} from './project-layout.mjs';
import {writeZip} from './bundle-zip.mjs';

const MAX_FILE=256*1024*1024,MAX_SET=512*1024*1024;
const uuid=z.string().uuid();
const metadata=z.record(z.string(),z.unknown()).default({}).refine(v=>JSON.stringify(v).length<=32000,'Metadata exceeds 32,000 characters');
const fileInfo=z.object({name:z.string().min(1).max(200),role:z.enum(['input','output','other']).default('input'),description:z.string().max(8000).default(''),metadata});
const setInfo=z.object({title:z.string().trim().min(1).max(200),description:z.string().max(12000).default(''),blockIds:z.array(z.string().min(1).max(200)).max(100).default([]),checkpointId:uuid.nullable().default(null),metadata});
export const referenceManifest=z.object({version:z.literal(1),id:uuid,createdAt:z.string(),updatedAt:z.string(),...setInfo.shape,provenance:z.object({gitHead:z.string().nullable(),dirty:z.boolean().nullable(),graphSha256:z.string(),note:z.string()}),files:z.array(fileInfo.extend({id:uuid,file:z.string(),size:z.number().int().nonnegative().max(MAX_FILE),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).max(64)});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function safePath(workspace,...parts){
 const base=path.resolve(workspace),target=path.resolve(base,...parts),relative=path.relative(base,target);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Path must remain inside the workspace');
 let cursor=base;for(const part of relative.split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw new Error('Linked reference paths are not supported');}catch(error){if(error.code!=='ENOENT')throw error;}}
 return target;
}
const root=w=>safePath(w,'.isp','reference-sets');
const folder=(w,id)=>safePath(w,'.isp','reference-sets',uuid.parse(id));
function read(w,id){uuid.parse(id);const file=safePath(w,'.isp','reference-sets',id,'manifest.json');if(!fs.existsSync(file))throw new Error('참조 세트를 찾을 수 없습니다.');const set=referenceManifest.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(set.id!==id)throw new Error('Reference ID mismatch');return set;}
function write(w,set){const dir=folder(w,set.id),file=path.join(dir,'manifest.json');safePath(w,path.relative(w,file));safePath(w,path.relative(w,file+'.tmp'));const previous=Date.parse(set.updatedAt);set.updatedAt=new Date(Math.max(Date.now(),Number.isFinite(previous)?previous+1:0)).toISOString();fs.writeFileSync(file+'.tmp',JSON.stringify(set,null,2));fs.renameSync(file+'.tmp',file);return set;}
function filePath(w,set,item){if(item.file!==`files/${item.id}.bin`)throw new Error('Unsafe reference file path');return safePath(w,'.isp','reference-sets',set.id,'files',item.id+'.bin');}
export function listReferenceSets(w){const dir=root(w);return fs.existsSync(dir)?fs.readdirSync(dir).filter(id=>uuid.safeParse(id).success).map(id=>read(w,id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):[];}
function attach(w,set,info,bytes){
 if(set.files.length>=64||bytes.length>MAX_FILE||set.files.reduce((n,f)=>n+f.size,0)+bytes.length>MAX_SET)throw new Error('참조 세트 한도: 64개 파일, 파일당 256 MiB, 합계 512 MiB');
 const id=crypto.randomUUID(),item={...fileInfo.parse(info),id,file:`files/${id}.bin`,size:bytes.length,sha256:hash(bytes)};
 fs.mkdirSync(safePath(w,'.isp','reference-sets',set.id,'files'),{recursive:true});fs.writeFileSync(filePath(w,set,item),bytes,{flag:'wx'});set.files.push(item);return item;
}
function sourceBytes(w,file){const target=safePath(w,file);const real=fs.realpathSync(target),base=fs.realpathSync(w);if(!real.startsWith(base+path.sep))throw new Error('Reference input must be inside the workspace');const stat=fs.statSync(real);if(!stat.isFile()||stat.size>MAX_FILE)throw new Error('파일은 256 MiB 이하여야 합니다.');return fs.readFileSync(real);}
export function createReferenceSet(w,input){
 const spec=setInfo.parse(input),id=crypto.randomUUID(),dir=folder(w,id);fs.mkdirSync(dir,{recursive:true});
 try{
  if(spec.checkpointId){const tracking=JSON.parse(fs.readFileSync(path.join(w,'.isp/tracking.json'),'utf8'));if(!tracking.checkpoints?.some(c=>c.id===spec.checkpointId))throw new Error('Checkpoint not found');}
  let gitHead=null,dirty=null;const source=sourceRoot(w);
  try{gitHead=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();dirty=!!execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8',windowsHide:true}).trim();}catch{}
  const set={version:1,id,...spec,createdAt:new Date().toISOString(),updatedAt:'',provenance:{gitHead,dirty,graphSha256:hash(fs.readFileSync(path.join(source,'graph.json'))),note:'Registration context only; checkpoint association and production conditions are supplied by the author, not execution proof.'},files:[]};
  const files=z.array(fileInfo.extend({path:z.string().min(1)})).max(64).default([]).parse(input.files);
  for(const item of files)attach(w,set,item,sourceBytes(w,item.path));
  if(input.cropDeliveryId){uuid.parse(input.cropDeliveryId);const delivery=JSON.parse(fs.readFileSync(path.join(w,'.isp/viewer/crop-selection.json'),'utf8'))[0];if(delivery?.id!==input.cropDeliveryId)throw new Error('크롭 전달이 변경됐습니다. 최신 전달을 다시 확인하세요.');const requests=JSON.parse(fs.readFileSync(path.join(w,'.isp/viewer/requests.json'),'utf8'));
   for(const ref of delivery.items){const req=requests.find(r=>r.id===ref.requestId&&r.imageId===delivery.imageId),crop=(req?.crops||(req?.result?[{...req.result,id:req.id}]:[])).find(c=>c.id===ref.cropId);if(!crop)throw new Error('전달된 크롭이 삭제되었습니다.');for(const [index,region] of (crop.regions||[crop]).entries())attach(w,set,{name:`crop-${ref.cropId}-${index+1}${path.extname(region.paths.crop)}`,role:'input',description:crop.description||delivery.description||'',metadata:{roi:region.roi,spec:region.output,source:region.source,deliveryId:delivery.id,requestId:req.id,cropId:ref.cropId}},sourceBytes(w,region.paths.crop));}
  }
  return write(w,set);
 }catch(error){fs.rmSync(dir,{recursive:true,force:true});throw error;}
}
export function appendReferenceFile(w,id,info,bytes){const set=read(w,id),item=attach(w,set,info,bytes);try{return write(w,set);}catch(error){fs.rmSync(filePath(w,set,item),{force:true});throw error;}}
function ownedBytes(w,set,item){const file=filePath(w,set,item),size=fs.statSync(file).size;if(size!==item.size||size>MAX_FILE)throw new Error('Reference data size changed');const bytes=fs.readFileSync(file);if(hash(bytes)!==item.sha256)throw new Error('Reference data checksum mismatch');return bytes;}
export function compareReferenceFiles(w,setId,aId,bId){
 const set=read(w,setId),a=set.files.find(f=>f.id===aId),b=set.files.find(f=>f.id===bId);if(!a||!b)throw new Error('비교할 두 파일을 선택하세요.');
 const x=ownedBytes(w,set,a),y=ownedBytes(w,set,b);let differentBytes=Math.abs(x.length-y.length);const firstDifferences=[];
 for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i]){differentBytes++;if(firstDifferences.length<16)firstDifferences.push({offset:i,expected:x[i],actual:y[i]});}
 return {mode:'exact-bytes',equal:differentBytes===0,expectedBytes:x.length,actualBytes:y.length,differentBytes,firstDifferences,note:'Byte comparison only. Different packing, shape, dtype or layout requires explicit conversion before numerical comparison.'};
}
export function installReferenceSets(app,{current}){
 const workspace=()=>current().workspace;
 app.get('/api/reference-sets',(req,res)=>res.json(listReferenceSets(workspace())));
 app.post('/api/reference-sets',(req,res)=>res.status(201).json(createReferenceSet(workspace(),req.body)));
 app.get('/api/reference-sets/:id',(req,res)=>{const w=workspace(),set=read(w,req.params.id);res.json({...set,workspaceRoot:w,files:set.files.map(f=>({...f,absolutePath:filePath(w,set,f)}))});});
 app.patch('/api/reference-sets/:id',(req,res)=>{const w=workspace(),set=read(w,req.params.id);if(req.body.updatedAt!==set.updatedAt)return res.status(409).json({error:'참조 세트가 변경됐습니다. 다시 열어 주세요.'});const fields=setInfo.omit({checkpointId:true}).partial().parse(req.body);res.json(write(w,{...set,...fields}));});
 app.post('/api/reference-sets/:id/files/import',(req,res)=>{const info=fileInfo.extend({path:z.string().min(1)}).parse(req.body),w=workspace();res.status(201).json(appendReferenceFile(w,req.params.id,info,sourceBytes(w,info.path)));});
 app.post('/api/reference-sets/:id/files',express.raw({type:'application/octet-stream',limit:'256mb'}),(req,res)=>{if(!Buffer.isBuffer(req.body))throw new Error('파일 바이너리가 필요합니다.');const info=JSON.parse(decodeURIComponent(req.headers['x-reference-metadata']||'{}'));res.status(201).json(appendReferenceFile(workspace(),req.params.id,info,req.body));});
 app.get('/api/reference-sets/:id/files/:fileId',(req,res)=>{const w=workspace(),set=read(w,req.params.id),item=set.files.find(f=>f.id===req.params.fileId);if(!item)return res.sendStatus(404);res.download(filePath(w,set,item),item.name.replace(/[\\/]/g,'_'),{dotfiles:'allow'});});
 app.post('/api/reference-sets/:id/compare',(req,res)=>res.json(compareReferenceFiles(workspace(),req.params.id,uuid.parse(req.body.expectedId),uuid.parse(req.body.actualId))));
 app.delete('/api/reference-sets/:id',(req,res)=>{const w=workspace(),set=read(w,req.params.id);if(req.body.updatedAt!==set.updatedAt)return res.status(409).json({error:'참조 세트가 변경됐습니다. 새로고침 후 삭제하세요.'});const dir=folder(w,set.id),trash=safePath(w,'.isp','reference-sets','.delete-'+set.id);fs.renameSync(dir,trash);try{fs.rmSync(trash,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){fs.renameSync(trash,dir);throw error;}res.json({removed:set.id});});
 app.get('/api/reference-sets/:id/export',async(req,res,next)=>{const w=workspace(),set=read(w,req.params.id),temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-reference-export-'));try{const output=path.join(temp,'reference.zip');await writeZip(output,[{path:'manifest.json',data:Buffer.from(JSON.stringify(set,null,2))},...set.files.map(f=>({path:f.file,source:filePath(w,set,f),size:f.size,sha256:f.sha256}))]);res.download(output,`reference-${set.id}.zip`,()=>fs.rmSync(temp,{recursive:true,force:true}));}catch(error){fs.rmSync(temp,{recursive:true,force:true});next(error);}});
}
