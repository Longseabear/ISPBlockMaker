import fs from 'node:fs';
import path from 'node:path';

// Same server dependency roots as the Windows distribution. Browser modules
// are already compiled into dist; the SDK uses the separately installed CLI.
export function pruneLinuxRuntime(app){
 const lock=JSON.parse(fs.readFileSync(path.join(app,'package-lock.json'),'utf8'));
 const required=new Set();
 function visit(name,parent=''){
  let location=parent,relative;
  while(true){
   const candidate=path.posix.join(location,'node_modules',name);
   if(lock.packages[candidate]){relative=candidate;break;}
   if(!location||location==='.')throw Error('Unresolved runtime dependency '+name);
   location=path.posix.dirname(location);if(location==='.')location='';
  }
  if(required.has(relative))return;required.add(relative);
  for(const dependency of Object.keys(lock.packages[relative].dependencies||{}))visit(dependency,relative);
 }
 for(const name of ['@modelcontextprotocol/sdk','express','ws','zod','node-pty','prismjs','katex','parse5','postcss','postcss-value-parser','parse-srcset','@anthropic-ai/claude-agent-sdk'])visit(name);
 const remove=relative=>{
  const target=path.resolve(app,relative),base=path.resolve(app,'node_modules')+path.sep;
  if(!target.startsWith(base))throw Error('Refusing to prune outside staged node_modules');
  fs.rmSync(target,{recursive:true,force:true});
 };
 for(const relative of Object.keys(lock.packages).filter(p=>p.startsWith('node_modules/')).sort((a,b)=>b.length-a.length))
  if(!required.has(relative))remove(relative);
 remove('node_modules/.bin');
 // Linux is built from source here. Keep its native runtime, not Windows
 // prebuilds, object files or compilation inputs. Retain all license files.
 for(const relative of ['prebuilds','src','deps','test','tests','scripts'])remove('node_modules/node-pty/'+relative);
 const build=path.join(app,'node_modules/node-pty/build');
 for(const entry of fs.readdirSync(build))if(entry!=='Release')remove('node_modules/node-pty/build/'+entry);
 for(const entry of fs.readdirSync(path.join(build,'Release')))if(!['pty.node','spawn-helper'].includes(entry))remove('node_modules/node-pty/build/Release/'+entry);
 if(!fs.existsSync(path.join(build,'Release','pty.node')))throw Error('Missing Linux PTY runtime pty.node');
}
