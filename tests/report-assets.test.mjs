import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {readArtifactFile} from '../server/mcp-artifact-tools.mjs';
import {createStore} from '../server/store.mjs';
import {updateArtifact} from '../server/artifact-update.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-report-assets-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);return file;};
 const html=value=>write('report/index.html',value);
 const read=()=>readArtifactFile(root,'report/index.html');
 return {root,write,html,read};
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=','base64');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

test('HTML packaging embeds nested CSS, images, srcset, fonts and classic JS without editing originals',t=>{
 const f=fixture(t);
 f.write('report/images/a.png',png);f.write('report/images/space name.png',png);
 f.write('report/fonts/local.woff2','FONT');
 f.write('report/styles/nested/colors.css','.sample{color:red;background:url(../../images/a.png)}');
 f.write('report/styles/main.css','@import "nested/colors.css" screen; @font-face{font-family:Local;src:url(../fonts/local.woff2)}');
 f.write('report/app.js','window.reportReady=true; const closing="</script>";');
 const input='<!doctype html><link rel="stylesheet" href="./styles/main.css"><img src="images/space%20name.png?rev=1" srcset="images/a.png 1x, images/a.png 2x"><div style="background:url(images/a.png)"></div><script src="app.js"></script>';
 f.html(input);const result=f.read(),html=Buffer.from(result.content,'base64').toString();
 assert.match(html,/data:image\/png;base64,/);assert.match(html,/data:font\/woff2;base64,/);assert.match(html,/@media screen/);assert.match(html,/window.reportReady=true/);
 assert.ok(!html.includes('<script src='));assert.ok(!html.includes('<link rel="stylesheet"'));assert.ok(!html.includes('@import'));
 assert.match(html,/<\\\/script>/);assert.match(html,/ 1x, data:image\/png;base64,.* 2x/);
 assert.equal(fs.readFileSync(path.join(f.root,'report/index.html'),'utf8'),input);
 assert.equal(result.assets.length,6);assert.equal(result.sha256,digest(input));assert.equal(result.packagedSha256,digest(Buffer.from(result.content,'base64')));
});

test('Already self-contained HTML and image artifacts retain exact bytes',t=>{
 const f=fixture(t),input='<h1>Hello</h1><style>body{color:red}</style><img src="data:image/png;base64,'+png.toString('base64')+'">';
 f.html(input);assert.equal(Buffer.from(f.read().content,'base64').toString(),input);assert.deepEqual(f.read().assets,[]);
 f.write('a.png',png);assert.deepEqual(Buffer.from(readArtifactFile(f.root,'a.png').content,'base64'),png);
});

test('Missing resources, network paths, workspace escapes and CSS cycles fail with actionable errors',t=>{
 const f=fixture(t);
 for(const [html,pattern] of [
  ['<img src="missing.png">',/Missing local asset.*missing.png/],
  ['<img src="https://example.com/a.png">',/relative local/],
  ['<img src="//example.com/a.png">',/relative local/],
  ['<img src="../../outside.png">',/Invalid graph path/],
  ['<img src="%2fetc/passwd">',/Invalid asset path/],
  ['<base href="/other/"><img src="a.png">',/<base>/],
  ['<script type="module" src="app.js"></script>',/modules/],
 ]){f.html(html);assert.throws(f.read,pattern);}
 f.write('report/a.css','@import "b.css";');f.write('report/b.css','@import "a.css";');f.html('<link rel="stylesheet" href="a.css">');assert.throws(f.read,/Cyclic/);
});

test('Asset paths cannot follow a linked directory outside the workspace',t=>{
 const f=fixture(t),other=fs.mkdtempSync(path.join(os.tmpdir(),'isp-report-outside-'));t.after(()=>fs.rmSync(other,{recursive:true,force:true}));
 fs.writeFileSync(path.join(other,'a.png'),png);fs.mkdirSync(path.join(f.root,'report'));
 fs.symlinkSync(other,path.join(f.root,'report/linked'),process.platform==='win32'?'junction':'dir');
 f.html('<img src="linked/a.png">');assert.throws(f.read,/Linked graph/);
});

test('Packaged output size is checked after base64 expansion',t=>{
 const f=fixture(t);f.write('report/large.png',Buffer.alloc(8*1024*1024));f.html('<img src="large.png">');assert.throws(f.read,/Packaged HTML exceeds/);
});

test('Updating an asset refreshes registration hashes while retaining experiment metadata',t=>{
 const f=fixture(t);f.write('report/a.png',png);f.html('<img src="a.png">');const first=f.read();
 const dir=path.join(f.root,'store');fs.mkdirSync(dir);const store=createStore(dir);
 const original={id:'report',file:'original.html',kind:'html',title:'Result',revision:1,blockId:'input',runId:'attempt',createdAt:'2026-01-01',metadata:{metric:123,registrationSource:first.registrationSource}};
 store.artifact(original);fs.writeFileSync(path.join(dir,original.file),Buffer.from(first.content,'base64'));
 f.write('report/a.png',Buffer.concat([png,Buffer.from('changed')]));const next=f.read();
 const result=updateArtifact(store,dir,'report',{expectedFile:original.file,kind:'html',content:next.content,registrationSource:next.registrationSource});
 assert.equal(result.metadata.metric,123);assert.equal(result.revision,1);assert.equal(result.runId,'attempt');assert.equal(result.createdAt,original.createdAt);
 assert.equal(result.metadata.registrationSource.sha256,first.sha256);assert.notEqual(result.metadata.registrationSource.packagedSha256,first.packagedSha256);
 assert.notEqual(result.metadata.registrationSource.assets[0].sha256,first.assets[0].sha256);
 assert.throws(()=>updateArtifact(store,dir,'report',{expectedFile:original.file,kind:'html',content:next.content}),/최신|변경/);
});


test('Deferred scripts keep parser scheduling through embedded data URLs',t=>{
 const f=fixture(t);f.write('report/app.js','window.ready=true;');f.html('<script defer src="app.js"></script>');
 const output=Buffer.from(f.read().content,'base64').toString();assert.match(output,/<script defer="" src="data:text\/javascript;base64,/);
 f.html(output);assert.equal(Buffer.from(f.read().content,'base64').toString(),output);
});
