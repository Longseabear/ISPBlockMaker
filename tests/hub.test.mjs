import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHub} from '../server/hub.mjs';
import {openWorkspaceServer} from '../server/workspace-open.mjs';
import {listWorkspaces} from '../server/workspace-registry.mjs';

test('unified hub adopts existing servers, preserves isolated projects, serializes repeated opens and guards shutdown', {timeout:90000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-hub-')),stateRoot=path.join(temp,'state');
 const old=process.env.ISP_STATE_HOME;process.env.ISP_STATE_HOME=stateRoot;
 let hub;const running=new Map();
 const stop=async url=>{try{const health=await fetch(url+'/health').then(r=>r.json()),boot=await fetch(url+'/api/bootstrap').then(r=>r.json());await fetch(url+'/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+boot.token,'Content-Type':'application/json'},body:JSON.stringify({instance:health.instance})});}catch{}};
 try{
  const a=path.join(temp,'작업 A'),b=path.join(temp,'B');fs.mkdirSync(a);fs.mkdirSync(b);
  const existing=await openWorkspaceServer(process.cwd(),a);running.set(a,existing.url);
  hub=await createHub({stateRoot,port:0});const api=async(route,body,method)=>{const response=await fetch(hub.url+'/api'+route,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+hub.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
  assert.equal((await fetch(hub.url+'/api/projects')).status,401);
  assert.equal((await fetch(hub.url+'/api/bootstrap',{headers:{Origin:'http://evil.invalid'}})).status,403);
  assert.equal(await new Promise((resolve,reject)=>{http.get(hub.url+'/api/projects',{headers:{Host:'evil.invalid',Authorization:'Bearer '+hub.token}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);}),403);
  let listing=(await api('/projects')).data;assert.equal(listing.projects.length,1);assert.equal(listing.projects[0].url,existing.url);
  const opened=await Promise.all([api('/open',{path:b}),api('/open',{path:b})]);assert.equal(opened[0].data.url,opened[1].data.url);running.set(b,opened[0].data.url);
  assert.equal((await api('/open',{path:a})).data.url,existing.url);
  listing=(await api('/projects')).data;assert.equal(listing.projects.length,2);assert.ok(listing.projects.every(p=>p.running));assert.equal(listing.projects.find(p=>p.id===listing.selected).path,a);
  assert.equal((await fetch(hub.url)).status,410);
  const folders=await listWorkspaces(a,stateRoot);
  assert.equal(folders.length,2);assert.ok(folders.find(p=>p.path===a).current);assert.ok(folders.every(p=>p.running));
  const boot=await fetch(existing.url+'/api/bootstrap').then(r=>r.json());
  const folderResponse=await fetch(existing.url+'/api/workspaces',{headers:{Authorization:'Bearer '+boot.token}});
  assert.equal(folderResponse.status,200);assert.equal((await folderResponse.json()).length,2);
  const target=listing.projects.find(p=>p.path===b);
  assert.equal((await api('/projects/'+target.id+'/stop',{instance:'wrong'})).status,409);
  assert.equal((await api('/projects/'+target.id+'/stop',{instance:target.instance})).status,200);
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));listing=(await api('/projects')).data;if(!listing.projects.find(p=>p.id===target.id).running)break;}
  assert.equal(listing.projects.find(p=>p.id===target.id).running,false);assert.equal(listing.projects.find(p=>p.path===a).running,true);
  await hub.close();hub=await createHub({stateRoot,port:0});listing=(await api('/projects')).data;assert.equal(listing.projects.length,2);assert.equal(listing.projects.find(p=>p.path===a).url,existing.url);
  const restart=(await api('/open',{path:b})).data;running.set(b,restart.url);assert.equal(restart.id,target.id);assert.notEqual((await fetch(restart.url+'/health').then(r=>r.json())).instance,target.instance);
 }finally{await hub?.close();await Promise.all([...running.values()].map(stop));await new Promise(r=>setTimeout(r,1200));if(old===undefined)delete process.env.ISP_STATE_HOME;else process.env.ISP_STATE_HOME=old;assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));fs.rmSync(temp,{recursive:true,force:true});}
});
