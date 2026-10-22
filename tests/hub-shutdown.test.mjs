import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createHub} from '../server/hub.mjs';

test('shutdown-all validates the confirmed instances, preserves failures, and closes the hub only after workers stop',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-stop-all-')),stateRoot=path.join(temp,'state');fs.mkdirSync(stateRoot);
 const workers=[];
 for(const name of ['A','B']){
  const folder=path.join(temp,name);fs.mkdirSync(path.join(folder,'.isp'),{recursive:true});
  const w={id:crypto.randomUUID(),instance:crypto.randomUUID(),folder,refuse:name==='B',requests:0};
  w.server=http.createServer((req,res)=>{
   res.setHeader('Content-Type','application/json');
   if(req.url==='/health')return res.end(JSON.stringify({app:'ISPBlockMaker',workspace:folder,instance:w.instance}));
   if(req.url==='/api/bootstrap')return res.end(JSON.stringify({token:'fixture'}));
   if(req.url==='/api/shutdown'){w.requests++;if(w.refuse){res.statusCode=500;return res.end('{}');}res.end('{}');setTimeout(()=>{w.server.close();w.server.closeAllConnections();},30);return;}
   res.statusCode=404;res.end('{}');
  });
  await new Promise(r=>w.server.listen(0,'127.0.0.1',r));w.url='http://127.0.0.1:'+w.server.address().port;
  fs.writeFileSync(path.join(folder,'.isp/connection.json'),JSON.stringify({url:w.url}));workers.push(w);
 }
 fs.writeFileSync(path.join(stateRoot,'hub-projects.json'),JSON.stringify(workers.map(w=>({id:w.id,path:w.folder}))));
 const hub=await createHub({stateRoot,port:0});
 t.after(async()=>{await hub.close();for(const w of workers){w.server.closeAllConnections();await new Promise(r=>w.server.close(r));}fs.rmSync(temp,{recursive:true,force:true});});
 const api=async(route,body)=>{const response=await fetch(hub.url+'/api'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+hub.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
 const identity=await fetch(hub.url+'/health').then(r=>r.json());
 const targets=workers.map(w=>({id:w.id,instance:w.instance}));
 assert.equal((await api('/shutdown-all',{instance:'wrong',servers:targets})).status,409);
 assert.equal((await api('/shutdown-all',{instance:identity.instance,servers:[]})).status,409);
 assert.ok(workers.every(w=>w.requests===0));
 const partial=await api('/shutdown-all',{instance:identity.instance,servers:targets});
 assert.equal(partial.status,409);assert.equal(partial.data.results[0].stopped,true);assert.equal(partial.data.results[1].stopped,false);
 assert.equal((await api('/projects')).status,200);
 workers[1].refuse=false;
 const result=await api('/shutdown-all',{instance:identity.instance,servers:[targets[1]]});assert.equal(result.status,200);
 const blocked=await api('/open',{path:workers[0].folder});assert.equal(blocked.status,409);
 await new Promise(r=>setTimeout(r,250));
 await assert.rejects(fetch(hub.url+'/health'));
 assert.equal(fs.existsSync(path.join(stateRoot,'hub.json')),false);
 assert.equal(fs.existsSync(path.join(stateRoot,'hub-projects.json')),true);
});
