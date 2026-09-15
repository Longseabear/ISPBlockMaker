import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import {packBundle,unpackBundle,planBundle} from '../server/bundles.mjs';
import {openWorkspace} from '../server/workspaces.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function parseArgs(args){const flags=new Set(['--without-images','--with-git','--dry-run','--no-open','--help']),values=new Set(['-o','--into']);const positional=[],options={};for(let i=0;i<args.length;i++){const a=args[i];if(flags.has(a)){options[a]=true;}else if(values.has(a)){if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+a);options[a]=args[++i];}else if(a.startsWith('-'))throw new Error('Unknown option: '+a);else positional.push(a);}return {positional,options};}
async function launch(folder){const executable=path.join(root,'ISPBlockMaker.exe');await fs.access(executable);const child=spawn(executable,folder?[folder]:[],{cwd:process.cwd(),detached:true,stdio:'ignore',windowsHide:false});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();}
async function exportFromRunning(workspace,output,options){
 let c;try{c=JSON.parse(await fs.readFile(path.join(workspace,'.isp/connection.json'),'utf8'));}catch{return false;}
 let url;try{url=new URL(c.url);}catch{return false;}if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw new Error('Invalid local bridge URL');
 try{const health=await fetch(new URL('/health',url),{redirect:'error',signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(health.app!=='ISPBlockMaker'||path.resolve(health.workspace)!==workspace)throw new Error('Workspace server mismatch');}catch(e){if(e.message==='Workspace server mismatch')throw e;return false;}
 const response=await fetch(new URL('/api/bundle/export',url),{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(options),redirect:'error',signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error((await response.json()).error||'Bundle export failed');let created=false;const out=createWriteStream(output,{flags:'wx'});out.once('open',()=>created=true);try{await pipeline(Readable.fromWeb(response.body),out);}catch(e){if(created)await fs.rm(output,{force:true});throw e;}return true;
}
export async function main(args=process.argv.slice(2)){
 const {positional:p,options:o}=parseArgs(args);if(o['--help']){console.log('isp-block-maker [folder]\nisp-block-maker pack [folder] -o project.bundle [--without-images] [--with-git] [--dry-run]\nisp-block-maker open project.bundle --into NEW_FOLDER [--no-open]');return;}
 if(p[0]==='pack'){
  if(p.length>2||o['--into']||o['--no-open'])throw new Error('Use pack [folder] -o file.bundle');const workspace=await fs.realpath(p[1]||'.'),options={includeImages:!o['--without-images'],includeGit:!!o['--with-git']};
  if(o['--dry-run']){const {files,...plan}=await planBundle(workspace,options);console.log(JSON.stringify({...plan,files:files.map(({path,size})=>({path,size}))},null,2));return;}
  if(!o['-o']||!o['-o'].toLowerCase().endsWith('.bundle'))throw new Error('Specify -o file.bundle');const output=path.resolve(o['-o']);if(await fs.lstat(output).then(()=>true,()=>false))throw new Error('Output already exists');if(!await exportFromRunning(workspace,output,options))await packBundle(workspace,output,options);console.log('Bundle saved: '+output);return;
 }
 if(p[0]==='open'||p[0]?.toLowerCase().endsWith('.bundle')){
  const file=p[0]==='open'?p[1]:p[0];if(!file||p.length>(p[0]==='open'?2:1)||!o['--into']||o['-o']||o['--with-git']||o['--without-images']||o['--dry-run'])throw new Error('Use open file.bundle --into NEW_FOLDER [--no-open]');const result=await unpackBundle(path.resolve(file),o['--into']);openWorkspace(result.workspace,root);console.log('Bundle restored: '+result.workspace);if(!result.manifest.includeImages)console.log('Viewer originals omitted; existing crops remain available.');if(!o['--no-open'])await launch(result.workspace);return;
 }
 if(p.length>1||Object.keys(o).length)throw new Error('Unknown command or option. Run --help.');await launch(p[0]?await fs.realpath(p[0]):null);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
