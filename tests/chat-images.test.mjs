import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readChatImage} from '../server/chat-images.mjs';
test('images resolve inside workspace, including spaces; outside files and non-images fail',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'isp-image-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
 const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const file=path.join(workspace,'sample image.png');fs.writeFileSync(file,data);fs.writeFileSync(path.join(root,'private.png'),data);fs.writeFileSync(path.join(workspace,'secret.png'),'not image');
 for(const source of [file,'sample%20image.png',pathToFileURL(file).href])assert.equal(readChatImage(workspace,source).url,'data:image/png;base64,'+data.toString('base64'));
 assert.throws(()=>readChatImage(workspace,'../private.png'),/워크스페이스/);
 assert.throws(()=>readChatImage(workspace,'secret.png'),/PNG/);
 fs.symlinkSync(root,path.join(workspace,'linked'),'junction');assert.throws(()=>readChatImage(workspace,'linked/private.png'),/워크스페이스/);
});
