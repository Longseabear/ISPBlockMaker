import test from 'node:test';
import assert from 'node:assert/strict';
import {McpSharing} from '../server/mcp-sharing.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('LAN sharing is opt-in, read-only, capability-protected and revocable',async t=>{
 const calls=[];let context={store:{get:()=>({revision:1,diagrams:[]})},search:{search:async(input,scope)=>{calls.push(scope);return {total:0,results:[]};}}};
 const sharing=new McpSharing(()=>context,{firstPort:0,host:'127.0.0.1'});t.after(()=>sharing.stop());
 assert.deepEqual(sharing.status(),{enabled:false});
 const status=await sharing.start(),url=status.urls[0];assert.equal(status.access,'read-only');assert.match(url,/\/mcp\/[a-f0-9]{64}$/);
 assert.equal((await fetch(url.replace(/.$/,'x'),{method:'POST',headers:{Connection:'close'}})).status,404);
 assert.equal((await fetch(url,{method:'POST',headers:{Origin:'http://other.example'}})).status,403);
 const client=new Client({name:'public-test',version:'1'});t.after(()=>client.close());await client.connect(new StreamableHTTPClientTransport(new URL(url)));
 const {tools}=await client.listTools();assert.ok(tools.length>0);assert.ok(tools.every(t=>t.annotations.readOnlyHint));assert.equal(tools.some(t=>t.name==='control_viewer'),false);
 await client.callTool({name:'search_workspace',arguments:{query:'noise'}});assert.deepEqual(calls,[{public:true}]);
 const rotated=await sharing.rotate();assert.notEqual(rotated.urls[0],url);assert.equal((await fetch(url,{method:'POST',headers:{Connection:'close'}})).status,404);
 await client.close();context={...context,store:{get:()=>({revision:2,diagrams:[]})}};
 assert.deepEqual(sharing.status(),{enabled:false});await sharing.stop();assert.deepEqual(sharing.status(),{enabled:false});
});

test('sharing falls back when the preferred port is occupied and does not persist activation',async t=>{
 const context={store:{},search:{}};const first=new McpSharing(()=>context,{firstPort:0,host:'127.0.0.1'});t.after(()=>first.stop());
 const a=await first.start();const second=new McpSharing(()=>context,{firstPort:a.port,host:'127.0.0.1',attempts:10});t.after(()=>second.stop());
 const b=await second.start();assert.notEqual(a.port,b.port);await second.stop();
 const fresh=new McpSharing(()=>context,{firstPort:0,host:'127.0.0.1'});assert.deepEqual(fresh.status(),{enabled:false});
});

test('source opt-in rejects unknown documents and binds selection to the reviewed workspace',async t=>{
 let context={store:{},search:{catalog:async()=>({sources:[{id:'file:filter.py'}]})}};
 const sharing=new McpSharing(()=>context,{firstPort:0,host:'127.0.0.1'});t.after(()=>sharing.stop());
 await assert.rejects(sharing.start({source_ids:['job:private']}),/unavailable/);assert.equal(sharing.status().enabled,false);
 const state=await sharing.start({source_ids:['file:filter.py']});assert.deepEqual(state.source_ids,['file:filter.py']);assert.equal(state.sources,true);
 await assert.rejects(sharing.start({source_ids:[]}),/Stop sharing/);await sharing.stop();
 let release;context={store:{},search:{catalog:()=>new Promise(r=>release=r)}};
 const pending=sharing.start({source_ids:['file:filter.py']});const rejected=assert.rejects(pending,/Workspace changed/);
 await new Promise(r=>setImmediate(r));context={...context,store:{}};release({sources:[{id:'file:filter.py'}]});await rejected;assert.equal(sharing.status().enabled,false);
});
