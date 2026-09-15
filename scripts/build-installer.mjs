import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
if (process.platform !== "win32") throw new Error("Build on Windows with the Node architecture used for distribution.");
const version=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version;
const buildId=`${version}-${Date.now()}`;
const release=path.join(root,"release");
const stage=path.join(release,`package-${buildId}`);
const appRelative=`versions/${buildId}`;
const app=path.join(stage,appRelative);
fs.mkdirSync(app,{recursive:true});
for(const name of ["dist","server","templates","package.json","ISPBlockMaker.exe"]){
  if(!fs.existsSync(path.join(root,name)))throw new Error(`Missing ${name}: run npm run build and npm run build:launcher first`);
  fs.cpSync(path.join(root,name),path.join(app,name),{recursive:true});
}
fs.mkdirSync(path.join(app,"scripts"));
for(const name of ["isp.mjs","start-local.mjs","workspace-cli.mjs"]) fs.copyFileSync(path.join(root,"scripts",name),path.join(app,"scripts",name));
fs.copyFileSync(process.execPath,path.join(app,"node.exe"));
const lock=JSON.parse(fs.readFileSync(path.join(root,"package-lock.json"),"utf8"));
const required = new Set();
function visit(name, parent = "") {
  let location = parent;
  let relative;
  while(true) {
    const candidate = path.posix.join(location,"node_modules",name);
    if(lock.packages[candidate]) {relative=candidate;break;}
    if(!location || location === ".") throw new Error(`Unresolved runtime dependency ${name}`);
    location=path.posix.dirname(location);
    if(location === ".") location="";
  }
  if(required.has(relative))return;
  required.add(relative);
  for(const dependency of Object.keys(lock.packages[relative].dependencies || {}))visit(dependency,relative);
}
for(const name of ["express","ws","zod","node-pty","prismjs"])visit(name);
for(const relative of required) {
  const pkg=lock.packages[relative];
  const source=path.join(root,relative);
  if(!fs.existsSync(source)) {if(pkg.optional)continue;throw new Error(`Missing dependency ${relative}`);}
  fs.cpSync(source,path.join(app,relative),{recursive:true});
}
// The Node runtime's license also includes bundled third-party notices.
const license=path.join(release,`node-${process.version}-LICENSE.txt`);
if(!fs.existsSync(license)) {
  const response=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Cannot obtain matching Node license (${response.status}). Put the exact runtime LICENSE at ${license}.`);
  fs.writeFileSync(license,await response.text());
}
fs.copyFileSync(license,path.join(app,"NODE-LICENSE.txt"));
fs.writeFileSync(path.join(app,"THIRD-PARTY-NOTICES.txt"),"Node notices: NODE-LICENSE.txt\nDependency licenses are preserved in node_modules/<package>/LICENSE or the corresponding license file.\n");
for(const name of ["install.ps1","uninstall.ps1"])fs.copyFileSync(path.join(root,"scripts",name),path.join(stage,name));
fs.writeFileSync(path.join(stage,"distribution.json"),JSON.stringify({version,app:appRelative,architecture:process.arch,node:process.version}));
function files(dir,prefix="") {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),prefix+e.name+"/"):[prefix+e.name]);}
fs.writeFileSync(path.join(stage,"package-files.json"),JSON.stringify([...files(stage),"package-files.json","bin/isp-block-maker.cmd","installed-files.json"]));
const zip=path.join(release,`ISPBlockMaker-${buildId}-${process.arch}.zip`);
execFileSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"scripts/package-installer.ps1"),"-Stage",stage,"-Archive",zip],{stdio:"inherit",windowsHide:true});
const exe=path.join(release,"ISPBlockMaker-Setup.exe");
let bytes;
for(let attempt=0;attempt<20;attempt++) {
  try { bytes=fs.readFileSync(exe);break; }
  catch(error) {if(!["EBUSY","EACCES"].includes(error.code)||attempt===19)throw error;await new Promise(r=>setTimeout(r,1000));}
}
fs.writeFileSync(exe+".sha256",crypto.createHash("sha256").update(bytes).digest("hex")+"  ISPBlockMaker-Setup.exe\n");
console.log(`Installer: ${exe}\nOffline ZIP: ${zip}\nArchitecture: ${process.arch}`);
