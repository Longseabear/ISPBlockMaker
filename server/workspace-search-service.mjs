import {WorkspaceSearch} from './workspace-search.mjs';

// Keep worker/database ownership aligned with the active store, including restores
// that replace the store while retaining the same directory names.
export class WorkspaceSearchService {
 constructor(current,create=options=>new WorkspaceSearch(options)){
  this.current=current;this.create=create;this.serial=Promise.resolve();this.active=null;this.closed=false;
 }
 matches(a,b){return a?.sourceRoot===b?.sourceRoot&&a?.dataDir===b?.dataDir&&a?.store===b?.store;}
 run(method,input,scope){
  if(this.closed)return Promise.reject(Error('Search closed'));
  const requested=this.current();
  const operation=this.serial.then(async()=>{
   if(!this.matches(requested,this.current()))throw Error('Workspace changed; retry the search');
   if(!this.matches(this.active?.context,requested)){
    if(this.active){await this.active.search.close();this.active=null;}
    this.active={context:requested,search:this.create(requested)};
   }
   const result=await this.active.search[method](input,scope);
   if(!this.matches(requested,this.current()))throw Error('Workspace changed; discard stale search results');
   return result;
  });
  this.serial=operation.catch(()=>{});return operation;
 }
 search(input,scope){return this.run('search',input,scope);}
 read(input,scope){return this.run('read',input,scope);}
 catalog(){return this.run('catalog');}
 async close(){this.closed=true;await this.serial;if(this.active){await this.active.search.close();this.active=null;}}
}
