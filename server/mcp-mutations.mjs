import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export class McpMutations {
 constructor(dataDir){this.folder=path.join(dataDir,'mcp-requests');this.pending=new Map();}
 execute(name,input,operation){
  if(!/^[a-f0-9-]{36}$/i.test(input.request_id||''))return Promise.reject(Error('A UUID request_id is required'));
  const digest=crypto.createHash('sha256').update(JSON.stringify(canonical({name,input}))).digest('hex');
  const previous=this.pending.get(input.request_id);
  if(previous)return previous.digest===digest?previous.result:Promise.reject(Error('request_id conflict: payload differs'));
  const result=this.run(input.request_id,digest,operation);this.pending.set(input.request_id,{digest,result});
  void result.finally(()=>this.pending.delete(input.request_id)).catch(()=>{});return result;
 }
 async run(id,digest,operation){
  fs.mkdirSync(this.folder,{recursive:true});
  if(fs.lstatSync(this.folder).isSymbolicLink())throw Error('MCP request directory must not be linked');
  const file=path.join(this.folder,id+'.json');
  if(fs.existsSync(file)){
   if(fs.lstatSync(file).isSymbolicLink())throw Error('MCP request record must not be linked');
   const saved=JSON.parse(fs.readFileSync(file,'utf8'));
   if(saved.digest!==digest)throw Error('request_id conflict: payload differs');
   if(saved.status==='completed')return saved.result;
   throw Error(saved.error||'Previous request outcome is uncertain; inspect workspace state before submitting a new request_id');
  }
  const saved={digest,status:'pending',createdAt:new Date().toISOString()};
  fs.writeFileSync(file,JSON.stringify(saved),{flag:'wx',mode:0o600});
  const save=value=>{const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}};
  try{const result=await operation();save({...saved,status:'completed',result});return result;}
  catch(error){const message=String(error.message||error).slice(0,2000);try{save({...saved,status:'uncertain',error:message+'; inspect current state before submitting a new request_id'});}catch{}throw error;}
 }
}
