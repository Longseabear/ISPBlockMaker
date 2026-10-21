import fs from 'node:fs/promises';
import crypto from 'node:crypto';
// A single writer owns the rename order. Repeated requests coalesce to the latest snapshot.
export class AsyncSnapshot {
 constructor(file){this.file=file;this.pending=null;this.running=null;}
 write(snapshot){
  this.pending=snapshot;
  if(!this.running)this.running=Promise.resolve().then(async()=>{
   while(this.pending){const read=this.pending;this.pending=null;const content=JSON.stringify(read());const temp=this.file+'.'+crypto.randomUUID()+'.tmp';
    try{await fs.writeFile(temp,content,{mode:0o600,flag:'wx'});await fs.rename(temp,this.file);}catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}
   }
  }).finally(()=>{this.running=null;});
  return this.running;
 }
 flush(){return this.running||Promise.resolve();}
}
