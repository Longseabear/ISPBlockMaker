import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import {z} from 'zod';
import {workspaceMcpHandler} from './workspace-mcp.mjs';

export class McpSharing {
 constructor(current,{firstPort=4312,attempts=10,host='0.0.0.0'}={}){
  this.current=current;this.firstPort=firstPort;this.attempts=attempts;this.host=host;this.active=null;this.serial=Promise.resolve();
 }
 exclusive(fn){const result=this.serial.then(fn);this.serial=result.catch(()=>{});return result;}
 status(){
  const active=this.active;
  if(!active)return {enabled:false};
  if(active.owner!==this.current().store){void this.stop();return {enabled:false};}
  const addresses=new Set(['127.0.0.1']);
  for(const entries of Object.values(os.networkInterfaces()))for(const info of entries||[])if(info.family==='IPv4'&&!info.internal)addresses.add(info.address);
  return {enabled:true,port:active.port,urls:[...addresses].map(address=>`http://${address}:${active.port}/mcp/${active.key}`),access:'read-only',source_ids:active.sourceIds,image_ids:active.imageIds,sources:active.sourceIds.length>0,images:active.imageIds.length>0,startedAt:active.startedAt};
 }
 start(options={}){const owner=this.current().store;return this.exclusive(async()=>{
  const sourceIds=[...new Set(z.array(z.string().min(1).max(4096)).max(200).parse(options.source_ids||[]))];
  const imageIds=[...new Set(z.array(z.string().uuid()).max(200).parse(options.image_ids||[]))];
  if(imageIds.length){const images=this.current().sharedImages?.list()||[];if(imageIds.some(id=>!images.some(image=>image.id===id)))throw Error('Selected image is unavailable; refresh the sharing list');}
  if(sourceIds.length){const catalog=await this.current().search.catalog();if(sourceIds.some(id=>!catalog.sources.some(s=>s.id===id)))throw Error('Selected source is unavailable; refresh the sharing list');}
  if(owner!==this.current().store)throw Error('Workspace changed; review sharing again');
  if(this.active&&(JSON.stringify(sourceIds)!==JSON.stringify(this.active.sourceIds)||JSON.stringify(imageIds)!==JSON.stringify(this.active.imageIds)))throw Error('Stop sharing before changing its scope');
  if(this.active&&this.active.owner===this.current().store)return this.status();
  await this.closeListener();
  if(owner!==this.current().store)throw Error('Workspace changed; review sharing again');
  const key=crypto.randomBytes(32).toString('hex');
  const listener=express();listener.disable('x-powered-by');
  const state={owner,key,sourceIds,imageIds,startedAt:new Date().toISOString(),server:http.createServer(listener),port:0,pending:new Set()};
  listener.use((req,res,next)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
   if(this.active!==state||state.owner!==this.current().store)return res.status(410).end();
   // This endpoint is for MCP clients. Browser cross-origin access is not enabled.
   if(req.headers.origin||req.headers['sec-fetch-site']==='cross-site')return res.status(403).end();
   if(req.path!==`/mcp/${state.key}`)return res.status(404).end();
   if(req.method!=='POST')return res.status(405).setHeader('Allow','POST').end();
   state.pending.add(res);res.once('close',()=>state.pending.delete(res));
   next();
  });
  listener.post(`/mcp/:capability`,express.json({limit:'64kb'}),workspaceMcpHandler(()=>{
   if(this.active!==state||owner!==this.current().store)throw Error('Share revoked');
   const {store,search,sharedImages}=this.current();return {store,search,sharedImages,scope:{public:true,...(state.imageIds.length?{imageIds:state.imageIds}:{}),...(state.sourceIds.length?{documentIds:state.sourceIds}:{})}};
  }));
  listener.use((error,req,res,next)=>{if(!res.headersSent)res.status(error.status===413?413:400).json({error:'Invalid MCP request'});});
  let bound=false;
  for(let i=0;i<this.attempts;i++){
   try{await new Promise((resolve,reject)=>{const failed=error=>{state.server.off('listening',ready);reject(error);};const ready=()=>{state.server.off('error',failed);resolve();};state.server.once('error',failed);state.server.once('listening',ready);state.server.listen(this.firstPort===0?0:this.firstPort+i,this.host);});bound=true;break;}
   catch(error){if(error.code!=='EADDRINUSE')throw error;}
  }
  if(!bound)throw Error('No available MCP sharing port');
  state.port=state.server.address().port;this.active=state;return this.status();
 });}
 async closeListener(){const active=this.active;this.active=null;if(active){active.server.closeAllConnections();await new Promise((resolve,reject)=>active.server.close(error=>error?reject(error):resolve()));}}
 stop(){return this.exclusive(async()=>{await this.closeListener();return {enabled:false};});}
 rotate(){return this.exclusive(async()=>{if(!this.active)throw Error('Sharing is disabled');this.active.key=crypto.randomBytes(32).toString('hex');for(const response of this.active.pending)response.destroy();return this.status();});}
}

export function installMcpSharing(app,current,options){
 const sharing=new McpSharing(current,options);
 app.get('/api/mcp/sharing',(_req,res)=>res.json(sharing.status()));
 app.get('/api/mcp/sharing/catalog',async(_req,res)=>res.json({...await current().search.catalog(),images:current().sharedImages?.list()||[]}));
 app.post('/api/mcp/sharing',async(req,res)=>{const input=z.object({enabled:z.literal(true),source_ids:z.array(z.string()).max(200).default([]),image_ids:z.array(z.string().uuid()).max(200).default([])}).strict().parse(req.body);res.json(await sharing.start(input));});
 app.delete('/api/mcp/sharing',async(_req,res)=>res.json(await sharing.stop()));
 app.post('/api/mcp/sharing/rotate',async(_req,res)=>res.json(await sharing.rotate()));
 return sharing;
}
