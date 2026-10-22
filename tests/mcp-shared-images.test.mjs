import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {McpSharing} from '../server/mcp-sharing.mjs';
import {sharedImages,sharedImagePreview} from '../server/mcp-shared-images.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('shared image tools expose only selected metadata and explicitly requested bounded image content',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-shared-images-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const directory=path.join(root,'.isp','viewer');fs.mkdirSync(directory,{recursive:true});
 const images=['Selected','Private'].map(name=>({id:crypto.randomUUID(),name,spec:{format:'raw',width:1024,height:2,bitDepth:12,alignment:'lsb',pattern:'RGGB',group:1,offset:0,stride:2048}}));
 fs.writeFileSync(path.join(directory,'images.json'),JSON.stringify(images));for(const image of images)fs.writeFileSync(path.join(directory,image.id+'.bin'),Buffer.alloc(4096));
 const context={store:{get:()=>({diagrams:[],revision:1})},search:{},sharedImages:{list:()=>sharedImages(root),read:id=>sharedImagePreview(root,id)}};
 const sharing=new McpSharing(()=>context,{firstPort:0,host:'127.0.0.1'});t.after(()=>sharing.stop());
 await assert.rejects(sharing.start({image_ids:[crypto.randomUUID()]}),/unavailable/);
 const status=await sharing.start({image_ids:[images[0].id]});assert.equal(status.images,true);
 const client=new Client({name:'image-test',version:'1'});t.after(()=>client.close());await client.connect(new StreamableHTTPClientTransport(new URL(status.urls[0])));
 const catalogue=await client.listTools();assert.ok(!catalogue.tools.some(t=>t.name==='control_viewer'));
 const listed=await client.callTool({name:'list_shared_images',arguments:{}});assert.equal(listed.structuredContent.images.length,1);assert.equal(listed.structuredContent.images[0].name,'Selected');assert.ok(listed.content.every(c=>c.type==='text'));
 const denied=await client.callTool({name:'read_shared_image',arguments:{image_id:images[1].id}});assert.equal(denied.isError,true);
 const read=await client.callTool({name:'read_shared_image',arguments:{image_id:images[0].id}});assert.equal(read.isError,undefined);
 const png=Buffer.from(read.content.find(c=>c.type==='image').data,'base64');assert.equal(png.readUInt32BE(16),512);assert.ok(png.readUInt32BE(20)<=512);
 fs.unlinkSync(path.join(directory,images[0].id+'.bin'));const missing=await client.callTool({name:'read_shared_image',arguments:{image_id:images[0].id}});assert.equal(missing.isError,true);assert.ok(!JSON.stringify(missing).includes(root));
 await client.close();await sharing.stop();
});
