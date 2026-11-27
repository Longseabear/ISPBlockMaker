import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {pruneLinuxRuntime} from './prune-linux-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const offline=process.argv.includes('--offline');
const systemNode=process.argv.includes('--system-node');
if(systemNode&&!offline)throw Error('--system-node requires --offline');
if(offline&&process.platform!=='linux')throw Error('Build the offline package on the target-compatible Linux architecture.');
const target=process.env.ISP_LINUX_TARGET||'';
if(target&&!/^[a-z0-9-]+$/.test(target))throw Error('Invalid Linux target label');
const name=`ISPBlockMaker-${version}-linux${offline?'-'+process.arch+(target?'-'+target:'')+'-offline'+(systemNode?'-slim':''):''}`;
const release=path.resolve(process.env.ISP_BUILD_OUTPUT||path.join(root,'release'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'isp-linux-package-'));
try {
 const app=path.join(temp,name);fs.mkdirSync(app);
 // Install native runtime dependencies on the target Linux machine, never copy
 // Windows node_modules or local workspace/configuration into the distribution.
 for(const entry of ['dist','server','templates','package.json','package-lock.json','THIRD_PARTY_NOTICES.md'])
  fs.cpSync(path.join(root,entry),path.join(app,entry),{recursive:true});
 fs.mkdirSync(path.join(app,'scripts'));
 for(const entry of ['agent-shell.mjs','isp.mjs','start-local.mjs','workspace-cli.mjs','recipe-terminal.mjs'])
  fs.copyFileSync(path.join(root,'scripts',entry),path.join(app,'scripts',entry));
 fs.mkdirSync(path.join(app,'docs'));
 for(const entry of ['linux.md','shared-terminals.md','workspace-mcp.md'])
  fs.copyFileSync(path.join(root,'docs',entry),path.join(app,'docs',entry));
 for(const [source,target] of [['setup.sh','setup.sh'],['isp-block-maker','isp-block-maker']]) {
  fs.writeFileSync(path.join(app,target),fs.readFileSync(path.join(root,'scripts/linux',source),'utf8').replaceAll('\r\n','\n'),{mode:0o755});
 }
 if(offline){
  // Install into a clean stage: never package a developer's node_modules or npm credentials.
  execFileSync('npm',['ci','--omit=dev','--no-audit','--no-fund','--foreground-scripts'],{cwd:app,stdio:'inherit',env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});
  pruneLinuxRuntime(app);
  if(!systemNode){
  fs.mkdirSync(path.join(app,'runtime'));
  fs.copyFileSync(process.execPath,path.join(app,'runtime/node'));fs.chmodSync(path.join(app,'runtime/node'),0o755);
  const license=process.env.ISP_NODE_LICENSE||path.resolve(path.dirname(process.execPath),'../LICENSE');
  if(!fs.existsSync(license))throw Error('Set ISP_NODE_LICENSE to the LICENSE from this exact Node distribution.');
  fs.copyFileSync(license,path.join(app,'runtime/LICENSE'));
  }
  const header=process.report.getReport().header;
  fs.writeFileSync(path.join(app,'offline.json'),JSON.stringify({version,node:process.version,bundledNode:!systemNode,nodeModuleVersion:process.versions.modules,architecture:process.arch,target:target||null,glibcBuild:header.glibcVersionRuntime||null},null,2)+'\n');
 }
 fs.mkdirSync(release,{recursive:true});
 const archive=path.join(release,name+'.tar.gz');
 execFileSync('tar',['-czf',name+'.tar.gz',name],{cwd:temp,stdio:'inherit'});
 fs.copyFileSync(path.join(temp,name+'.tar.gz'),archive);
 fs.writeFileSync(archive+'.sha256',crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')+'  '+path.basename(archive)+'\n');
 console.log(`Linux package: ${archive}\nInstall: bash setup.sh (${offline?(systemNode?'existing matching Node; bundled dependencies; Git required':'bundled Node and runtime dependencies; Git required'):'Node.js 22.16+, npm, Git required'})`);
} finally {fs.rmSync(temp,{recursive:true,force:true});}
