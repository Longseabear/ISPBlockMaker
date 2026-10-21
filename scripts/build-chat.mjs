import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vendor=path.join(root,'vendor/cloudcli');
function run(command,args,cwd){
 const result=spawnSync(command,args,{cwd,stdio:'inherit',windowsHide:true,shell:process.platform==='win32'&&command==='npm.cmd'});
 if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} failed (${result.status})`);
}
const npm=process.platform==='win32'?'npm.cmd':'npm';
if(!fs.existsSync(path.join(vendor,'node_modules/vite/package.json')))run(npm,['ci','--ignore-scripts','--no-audit','--no-fund'],vendor);
run(npm,['run','build'],vendor);
const out=path.join(root,'dist/cloudcli');
for(const file of ['LICENSE','NOTICE','UPSTREAM.json','INTEGRATION.md'])fs.copyFileSync(path.join(vendor,file),path.join(out,file));
// Ship the corresponding source alongside the browser bundle. Explicit roots
// exclude workspaces, state, credentials, git history and development binaries.
const inputs=['src','server','scripts','templates','tests','package.json','package-lock.json','tsconfig.json','index.html','vendor/cloudcli','THIRD_PARTY_NOTICES.md'].filter(name=>fs.existsSync(path.join(root,name)));
run('tar',['-czf','dist/cloudcli/source.tar.gz','--exclude=node_modules','--exclude=used-modules.json','--exclude=*.log',...inputs],root);
