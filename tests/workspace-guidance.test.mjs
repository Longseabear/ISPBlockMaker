import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {installWorkspaceGuidance} from '../server/workspace-guidance.mjs';
test('workspace agreement preserves user guidance, is idempotent and rejects linked targets',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-guidance-'));t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});
 fs.writeFileSync(path.join(dir,'AGENTS.md'),'User rules\n');fs.writeFileSync(path.join(dir,'CLAUDE.md'),'@AGENTS.md\nCustom rules\n');
 assert.deepEqual(installWorkspaceGuidance(dir,process.cwd()),['AGENTS.md','CLAUDE.md']);
 const a=fs.readFileSync(path.join(dir,'AGENTS.md'),'utf8'),c=fs.readFileSync(path.join(dir,'CLAUDE.md'),'utf8');assert.ok(a.startsWith('User rules\n'));assert.ok(c.startsWith('@AGENTS.md\nCustom rules\n'));
 fs.appendFileSync(path.join(dir,'AGENTS.md'),'User addition');assert.deepEqual(installWorkspaceGuidance(dir,process.cwd()),[]);assert.equal(fs.readFileSync(path.join(dir,'AGENTS.md'),'utf8'),a+'User addition');
 const linked=path.join(dir,'linked');fs.mkdirSync(linked);fs.symlinkSync(dir,path.join(linked,'AGENTS.md'),process.platform==='win32'?'junction':'dir');assert.throws(()=>installWorkspaceGuidance(linked,process.cwd()),/regular file/);assert.equal(fs.existsSync(path.join(linked,'CLAUDE.md')),false);
});

test('known legacy paragraphs migrate with a backup, custom text remains untouched',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-guidance-migrate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const legacy='- **Establish context.** At task start, discover `workspace-info`, read `graph-info`, affected block contexts and relevant project skills, and check actual source. Keep the task\'s block targets stable; clicking another node does not silently change the assignment. Inspect existing edits before modifying them.';
 const original='User header\n<!-- ISP Block Maker working agreement v1 -->\n'+legacy+'\nCustom instruction\n';
 fs.writeFileSync(path.join(dir,'AGENTS.md'),original);installWorkspaceGuidance(dir,process.cwd());
 const updated=fs.readFileSync(path.join(dir,'AGENTS.md'),'utf8');assert.match(updated,/not as a mandatory step/);assert.match(updated,/Custom instruction/);
 const backup=fs.readdirSync(dir).find(f=>f.startsWith('AGENTS.md.isp-backup-'));assert.equal(fs.readFileSync(path.join(dir,backup),'utf8'),original);
 assert.deepEqual(installWorkspaceGuidance(dir,process.cwd()),[]);
});
