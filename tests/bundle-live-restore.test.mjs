import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {openWorkspace} from '../server/workspaces.mjs';
import {packBundle} from '../server/bundles.mjs';

test('Live workspace bundle replacement preserves backup, refreshes authentication and clears prior viewer state', {timeout:60000}, async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'isp-bundle-live-'));
  const target=path.join(temp,'target'),incoming=path.join(temp,'incoming');
  await fs.mkdir(target);await fs.mkdir(incoming);
  openWorkspace(target,process.cwd());openWorkspace(incoming,process.cwd());
  await fs.writeFile(path.join(target,'precious-untracked.txt'),'preserve original');
  await fs.writeFile(path.join(incoming,'project','incoming.py'),'def process(image):\n    return image\n');
  const bundle=path.join(temp,'incoming.bundle');await packBundle(incoming,bundle);
  const probe=net.createServer().listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),env:{...process.env,ISP_WORKSPACE:target,ISP_STATE_HOME:path.join(temp,'state'),PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');let log='',socket;
  child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  try {
    const base=`http://127.0.0.1:${port}`;let boot;
    for(let i=0;i<100;i++){try{boot=await fetch(base+'/api/bootstrap').then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.ok(boot,log);
    const headers={Authorization:`Bearer ${boot.token}`,'Content-Type':'application/json'};
    const request=(route,body,h=headers)=>fetch(base+'/api'+route,{method:'POST',headers:h,body:JSON.stringify(body)});
    const json=async response=>{const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
    const raw=path.join(temp,'before.raw');await fs.writeFile(raw,Buffer.alloc(8*8*2,20));
    const image=await json(await request('/viewer/images/import',{path:raw,spec:{format:'raw',width:8,height:8,bitDepth:10,pattern:'GRBG',group:1}}));
    const preview=await json(await fetch(base+`/api/viewer/images/${image.id}/preview`,{headers}));
    const view={sessionId:crypto.randomUUID(),imageId:image.id,zoom:1,area:{x:0,y:0,width:8,height:8},visible:{x:0,y:0,width:8,height:8},highlights:[],render:{mode:'gray',gamma:1,black:0,white:1023},png:preview.url};
    await json(await request('/viewer/view',view));
    socket=new WebSocket(base.replace('http:','ws:')+'/ws?token='+boot.token);await once(socket,'open');
    const started=new Promise(resolve=>socket.on('message',data=>{if(JSON.parse(data).type==='started')resolve();}));
    socket.send(JSON.stringify({type:'start',sessionId:crypto.randomUUID(),agent:'shell',blockId:'input'}));await started;
    const messages=[];socket.on('message',data=>messages.push(JSON.parse(data)));
    const upload=await json(await fetch(base+'/api/bundle/import/preview',{method:'POST',headers:{Authorization:headers.Authorization,'Content-Type':'application/octet-stream'},body:await fs.readFile(bundle)}));
    const destination=await json(await request('/bundle/import/destination',{token:upload.token,destination:target,mode:'overwrite'}));
    assert.equal(destination.currentWorkspace,true);assert.equal(destination.serverRunning,true);
    // Live viewport heartbeats are ephemeral, so they must not invalidate the restore preview.
    await json(await request('/viewer/view',view));
    const changed=new Promise(resolve=>socket.on('message',data=>{const message=JSON.parse(data);if(message.type==='workspace-changed')resolve(message);}));
    const result=await json(await request('/bundle/import/confirm',{token:upload.token,destination:target,mode:'overwrite',destinationSnapshot:destination.snapshot}));
    assert.equal(result.workspace,target);assert.ok(result.backupPath);
    assert.equal(await fs.readFile(path.join(result.backupPath,'precious-untracked.txt'),'utf8'),'preserve original');
    assert.equal(await fs.readFile(path.join(target,'project','incoming.py'),'utf8'),'def process(image):\n    return image\n');
    assert.equal((await changed).bundleRestore.backupPath,result.backupPath);
    assert.equal((await fetch(base+'/api/viewer',{headers})).status,401);
    const fresh=await json(await fetch(base+'/api/bootstrap'));assert.notEqual(fresh.token,boot.token);assert.equal(fresh.state.name,'incoming');
    const freshHeaders={Authorization:`Bearer ${fresh.token}`,'Content-Type':'application/json'};
    assert.equal((await json(await fetch(base+'/api/viewer/view',{headers:freshHeaders}))).live,null);
    assert.equal((await json(await fetch(base+'/api/viewer',{headers:freshHeaders}))).images.length,0);
    assert.equal((await json(await request('/bundle/open',{id:result.id},freshHeaders))).url,base);
    const connection=JSON.parse(await fs.readFile(path.join(target,'.isp/connection.json'),'utf8'));assert.equal(connection.token,fresh.token);
    assert.ok(messages.some(m=>m.type==='workspace-changed'));
  } finally {
    socket?.terminate();child.kill();await exited;
    const resolved=path.resolve(temp);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('isp-bundle-live-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
