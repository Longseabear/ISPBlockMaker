import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
const uniform=z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).refine(v=>!v.startsWith('gl_')&&!['u_image','u_resolution'].includes(v));
export const gpuSchema=z.object({version:z.literal(1),id:z.string().regex(/^[a-zA-Z0-9_-]+$/).refine(v=>v!=='builtin-preview','Reserved extension id'),name:z.string().min(1).max(100),description:z.string().max(4000),blockId:z.string().optional(),fragment:z.string().min(1).max(100000),parameters:z.array(z.object({name:uniform,label:z.string().max(100),min:z.number().finite(),max:z.number().finite(),step:z.number().positive(),default:z.number().finite(),blockId:z.string().optional(),parameter:z.string().optional()}).refine(p=>p.min<p.max&&p.default>=p.min&&p.default<=p.max&&Boolean(p.blockId)===Boolean(p.parameter))).max(32)}).refine(x=>new Set(x.parameters.map(p=>p.name)).size===x.parameters.length,'Duplicate uniform');
export async function gpuExtensions(workspace){
 const root=await fs.realpath(workspace),folder=path.join(root,'extensions','gpu');let names;
 try{names=await fs.readdir(folder);}catch(e){if(e.code==='ENOENT')return {extensions:[],errors:[]};throw e;}
 const extensions=[],errors=[];
 for(const name of names.filter(n=>n.endsWith('.json')).sort().slice(0,50)){
  try{const file=await fs.realpath(path.join(folder,name));const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Extension outside workspace');if((await fs.stat(file)).size>150000)throw new Error('Extension too large');const raw=await fs.readFile(file,'utf8');const value=gpuSchema.parse(JSON.parse(raw));if(extensions.some(e=>e.id===value.id))throw new Error('Duplicate extension id');extensions.push({...value,hash:crypto.createHash('sha256').update(raw).digest('hex'),file:path.relative(root,file)});}catch(e){errors.push({file:name,error:e.message});}
 }
 return {extensions,errors};
}
