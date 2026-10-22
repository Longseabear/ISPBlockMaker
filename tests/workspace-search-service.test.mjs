import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSearchService} from '../server/workspace-search-service.mjs';

test('workspace switch and same-path restore close the old index before creating another',async()=>{
 let current={sourceRoot:'a',dataDir:'a-state',store:{}};const events=[];
 const service=new WorkspaceSearchService(()=>current,c=>({search:async()=>c.store,read:async()=>c.store,close:async()=>events.push(['close',c])}));
 assert.equal(await service.search({}),current.store);
 const old=current;current={...current,store:{restored:true}};
 assert.equal(await service.read({}),current.store);assert.equal(events[0][1],old);
 const restored=current;current={sourceRoot:'b',dataDir:'b-state',store:{other:true}};
 assert.equal(await service.search({}),current.store);assert.equal(events[1][1],restored);
 await service.close();await assert.rejects(service.search({}),/closed/);
});

test('in-flight and queued requests cannot return evidence from a replaced workspace',async()=>{
 let current={sourceRoot:'a',dataDir:'a-state',store:{}};let release,started;
 const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);
 const service=new WorkspaceSearchService(()=>current,()=>({search:async()=>{started();await pending;return {secret:'old workspace'};},close:async()=>{}}));
 const first=service.search({});const firstCheck=assert.rejects(first,/Workspace changed/);await ready;
 const queued=service.search({});const queuedCheck=assert.rejects(queued,/Workspace changed/);
 current={...current,store:{}};release();await Promise.all([firstCheck,queuedCheck]);await service.close();
});

test('shutdown waits for pending work and prevents new submissions',async()=>{
 const current={sourceRoot:'a',dataDir:'a',store:{}};let release,started;const events=[];
 const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);
 const service=new WorkspaceSearchService(()=>current,()=>({search:async()=>{started();await pending;events.push('result');return {};},close:async()=>events.push('closed')}));
 const request=service.search({});await ready;const closing=service.close();await assert.rejects(service.read({}),/closed/);assert.deepEqual(events,[]);
 release();await request;await closing;assert.deepEqual(events,['result','closed']);
});
