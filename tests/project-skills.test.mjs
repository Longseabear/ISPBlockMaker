import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openWorkspace} from '../server/workspaces.mjs';
import {packBundle,unpackBundle} from '../server/bundles.mjs';
import {writeZip} from '../server/bundle-zip.mjs';
import {saveProjectSkills,readProjectSkill,listProjectSkills,deleteProjectSkill,exportSkillBundle,readSkillBundle,installProjectSkills} from '../server/project-skills.mjs';
const root=process.cwd();
const skill=(name='raw-validation')=>({name,version:null,files:{'SKILL.md':`---\nname: ${name}\ndescription: "Validate project-specific RAW inputs"\n---\n\nRead [rules](references/rules.md).\n`,'references/rules.md':'Use GRBG and known bit depth.','scripts/check.py':'raise RuntimeError("Never run on import")\n'}});
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'isp-project-skills-'));}
function clean(w){assert.equal(path.dirname(w),path.resolve(os.tmpdir()));fs.rmSync(w,{recursive:true,force:true,maxRetries:5,retryDelay:100});}

test('Project skill CRUD preserves framework skills, guards revisions and archives old files',()=>{const w=temp();try{openWorkspace(w,root);const s=saveProjectSkills(w,root,[skill()])[0];assert.equal(s.managed,false);assert.match(fs.readFileSync(path.join(w,'.claude/skills/raw-validation/SKILL.md'),'utf8'),/\.agents\/skills\/raw-validation/);assert.ok(listProjectSkills(w,root).some(s=>s.managed));
 assert.throws(()=>saveProjectSkills(w,root,[skill()]),/changed/);const next=saveProjectSkills(w,root,[{...s,files:{...s.files,'references/rules.md':'new verified rules'}}])[0];assert.notEqual(next.version,s.version);assert.throws(()=>deleteProjectSkill(w,root,s.name,s.version),/changed/);const removed=deleteProjectSkill(w,root,s.name,next.version);assert.ok(fs.existsSync(path.join(removed.backup,s.name,'SKILL.md')));assert.equal(fs.existsSync(path.join(w,'.claude/skills',s.name)),false);
 assert.throws(()=>saveProjectSkills(w,root,[skill('isp-custom')]),/read-only/);
 assert.throws(()=>saveProjectSkills(w,root,[{...skill(),files:{...skill().files,'../escape.md':'x'}}]),/Unsafe/);
 assert.throws(()=>saveProjectSkills(w,root,[{...skill(),files:{...skill().files,'secret.env':'x'}}]),/Unsupported/);
 assert.throws(()=>saveProjectSkills(w,root,[{...skill(),files:{...skill().files,'SKILL.md':'no frontmatter'}}]),/frontmatter/);
 fs.mkdirSync(path.join(w,'.claude/skills/raw-validation'),{recursive:true});fs.writeFileSync(path.join(w,'.claude/skills/raw-validation/SKILL.md'),'user authored');assert.throws(()=>saveProjectSkills(w,root,[skill()]),/Claude skill differs/);assert.equal(fs.readFileSync(path.join(w,'.claude/skills/raw-validation/SKILL.md'),'utf8'),'user authored');
 }finally{clean(w);}});

test('Skills bundles preserve supporting files and full project bundles include both agent entrypoints',async()=>{const w=temp(),target=temp();try{openWorkspace(w,root);saveProjectSkills(w,root,[skill()]);const bundle=path.join(w,'skills.bundle');await exportSkillBundle(w,root,['raw-validation'],bundle);const parsed=await readSkillBundle(bundle);assert.deepEqual(parsed[0].files,skill().files);const imported=saveProjectSkills(target,root,parsed.map(s=>({...s,version:null})));assert.equal(imported[0].description,'Validate project-specific RAW inputs');
 const full=path.join(w,'project.bundle');await packBundle(w,full,{includeImages:false,includeViewer:false,includeData:false,includeVisualizations:false});const restored=path.join(target,'restored');await unpackBundle(full,restored);assert.deepEqual(readProjectSkill(restored,root,'raw-validation').files,skill().files);assert.ok(fs.existsSync(path.join(restored,'.claude/skills/raw-validation/SKILL.md')));
 const evil=path.join(w,'bad.bundle');await writeZip(evil,[{path:'manifest.json',data:Buffer.from(JSON.stringify({format:'isp-project-skills',version:1,skills:[{name:'raw-validation'}]}))},{path:'project/escape.md',data:Buffer.from('bad')}]);await assert.rejects(readSkillBundle(evil),/Unexpected/);
 }finally{clean(w);clean(target);}});

test('Linked directories are rejected and a multi-skill conflict cannot partially apply',()=>{const w=temp(),outside=temp();try{fs.mkdirSync(path.join(w,'.agents/skills'),{recursive:true});fs.symlinkSync(outside,path.join(w,'.agents/skills/raw-validation'),'junction');assert.throws(()=>saveProjectSkills(w,root,[skill()]),/Linked/);assert.deepEqual(fs.readdirSync(outside),[]);fs.unlinkSync(path.join(w,'.agents/skills/raw-validation'));const existing=saveProjectSkills(w,root,[skill()])[0];assert.throws(()=>saveProjectSkills(w,root,[skill('another-skill'),{...existing,version:null}]),/changed/);assert.equal(fs.existsSync(path.join(w,'.agents/skills/another-skill')),false);
 }finally{clean(w);clean(outside);}});

test('Authenticated skill HTTP and CLI support preview, explicit replacement and stale rejection',async()=>{const w=temp();let server;try{const app=express();app.use((req,res,next)=>req.headers.authorization==='Bearer test'?next():res.sendStatus(401));app.use(express.json());installProjectSkills(app,{current:()=>({workspace:w}),root});app.use((e,req,res,next)=>res.status(400).json({error:e.message}));server=app.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer test','Content-Type':'application/json'};const post=(route,body)=>fetch(url+'/api/skills/'+route,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await fetch(url+'/api/skills')).status,401);let r=await post('save',skill());assert.equal(r.status,200);const s=await r.json();const exported=await post('export',{names:[s.name]});assert.equal(exported.status,200);const bytes=Buffer.from(await exported.arrayBuffer());const rawHeaders={Authorization:'Bearer test','Content-Type':'application/octet-stream'};const preview=await(await fetch(url+'/api/skills/import/preview',{method:'POST',headers:rawHeaders,body:bytes})).json();assert.equal(preview[0].conflict,true);assert.equal(preview[0].version,s.version);
 await post('save',{...s,files:{...s.files,'references/rules.md':'new edit'}});r=await fetch(url+'/api/skills/import',{method:'POST',headers:{...rawHeaders,'X-Skill-Choices':encodeURIComponent(JSON.stringify([{name:s.name,version:s.version}]))},body:bytes});assert.equal(r.status,400);assert.match((await r.json()).error,/changed/);
 const env={...process.env,ISP_API_URL:url,ISP_API_TOKEN:'test'};const cli=await promisify(execFile)(process.execPath,['scripts/isp.mjs','skill-show',s.name],{env,windowsHide:true});assert.equal(JSON.parse(cli.stdout).files['references/rules.md'],'new edit');
 const pending=JSON.parse(cli.stdout);r=await fetch(url+'/api/skills/import',{method:'POST',headers:{...rawHeaders,'X-Skill-Choices':encodeURIComponent(JSON.stringify([{name:s.name,version:pending.version}]))},body:bytes});assert.equal(r.status,200);assert.equal(readProjectSkill(w,root,s.name).files['references/rules.md'],skill().files['references/rules.md']);
 const out=path.join(w,'cli.skills.bundle');await promisify(execFile)(process.execPath,['scripts/isp.mjs','skill-export',s.name,'--out',out],{env,windowsHide:true});
 const previewCli=JSON.parse((await promisify(execFile)(process.execPath,['scripts/isp.mjs','skill-import-preview',out],{env,windowsHide:true})).stdout);assert.equal(previewCli[0].conflict,true);const choices=path.join(w,'choices.json');fs.writeFileSync(choices,JSON.stringify(previewCli.map(s=>({name:s.name,version:s.version}))));
 const cliImport=JSON.parse((await promisify(execFile)(process.execPath,['scripts/isp.mjs','skill-import',out,'--choices',choices],{env,windowsHide:true})).stdout);assert.equal(cliImport[0].name,s.name);

 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}clean(w);}});
