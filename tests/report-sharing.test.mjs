import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const request=(url,options={})=>fetch(url,{...options,headers:{Connection:'close'}});
import {createReportSharing} from '../server/report-sharing.mjs';

test('LAN sharing snapshots, isolates routes, persists disabled and revokes without deleting originals',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-share-'));
  const dir=path.join(root,'shares'),source=path.join(root,'artifacts');fs.mkdirSync(source);
  const artifact={id:'a',file:'a.html',kind:'html',title:'Report',revision:3};
  fs.writeFileSync(path.join(source,'a.html'),'<h1>Original</h1>');
  const current=()=>({artifactDir:source,artifacts:[artifact]});
  const sharing=createReportSharing(dir,current);
  let restored;
  t.after(async()=>{await sharing.stop();await restored?.stop();fs.rmSync(root,{recursive:true,force:true});});
  const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  await sharing.start(port);const state=await sharing.publish('a'),token=state.items[0].token;
  const url=`http://127.0.0.1:${state.port}/s/${token}`;
  const response=await request(url);assert.equal(await response.text(),'<h1>Original</h1>');assert.match(response.headers.get('content-security-policy'),/connect-src 'none'/);assert.equal(response.headers.get('cache-control'),'no-store');
  for(const suffix of ['/api/bootstrap','/api/terminal','/shares.json','/s/bad','/s/'+token+'/../shares.json'])assert.equal((await request(`http://127.0.0.1:${state.port}${suffix}`)).status,404);
  assert.equal((await request(url,{method:'POST'})).status,404);
  fs.writeFileSync(path.join(source,'a.html'),'<h1>Changed</h1>');assert.equal(await (await request(url)).text(),'<h1>Original</h1>');
  assert.equal((await sharing.publish('a')).items[0].token,token);assert.equal(await (await request(url)).text(),'<h1>Changed</h1>');
  await sharing.stop();restored=createReportSharing(dir,current);assert.equal(restored.status().running,false);assert.equal(restored.status().items[0].token,token);await restored.start();assert.equal(await (await request(url)).text(),'<h1>Changed</h1>');
  await restored.revoke(token);assert.equal((await request(url)).status,404);assert.ok(fs.existsSync(path.join(source,'a.html')));
  await assert.rejects(restored.publish('missing'),/missing/);
  artifact.file='../secret.html';await assert.rejects(restored.publish('a'),/path/);
});

test('automatic port fallback and serialized publishing keep one share per artifact',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-share-port-'));
  fs.writeFileSync(path.join(root,'a.html'),'example');
  const busy=net.createServer();await new Promise(r=>busy.listen(0,'0.0.0.0',r));const port=busy.address().port;
  fs.writeFileSync(path.join(root,'shares.json'),JSON.stringify({port,items:[]}));
  const sharing=createReportSharing(root,()=>({artifactDir:root,artifacts:[{id:'a',file:'a.html',kind:'html',title:'A'}]}));
  t.after(async()=>{await sharing.stop();await new Promise(r=>busy.close(r));fs.rmSync(root,{recursive:true,force:true});});
  await assert.rejects(sharing.start(port),/EADDRINUSE/);
  await assert.rejects(sharing.start(0),/Port/);
  await Promise.all([sharing.publish('a'),sharing.publish('a')]);
  assert.notEqual(sharing.status().port,port);assert.equal(sharing.status().items.length,1);
});
