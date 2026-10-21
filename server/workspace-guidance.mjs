import fs from 'node:fs';
import path from 'node:path';

// Upgrade only exact known generated paragraphs; preserve user-authored changes.
const legacyParagraphs=["- **Establish context.** At task start, discover `workspace-info`, read `graph-info`, affected block contexts and relevant project skills, and check actual source. Keep the task's block targets stable; clicking another node does not silently change the assignment. Inspect existing edits before modifying them.", "- **Reconcile the affected graph.** At meaningful implementation/validation milestones and completion, use `.agents/skills/isp-block-maker/change-impact.md` to select affected records and checks. `graph-check` provides read-only structural/reference findings and shared-file impact, not proof of prose contracts or algorithm correctness. Update verified in-scope differences only; unchanged metadata needs no write.", "- **Reconcile the graph.** At task start, meaningful implementation/validation milestones, and handoff/completion, compare real processing flow, ports, I/O contracts, source entry points, descriptions and constraints with the graph. Update verified differences within the task scope only. If they already agree, do not manufacture revisions. Label planned/untested behavior honestly and record unresolved mismatches with evidence. Follow `.agents/skills/isp-block-maker/graph-maintenance.md`; no background timer or mandatory match percentage is needed."];
export function installWorkspaceGuidance(workspace, root) {
  const targets = ['AGENTS.md', 'CLAUDE.md'].map(name => {
    const file = path.join(workspace, name);
    try { if (fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile()) throw Error(`Workspace guidance must be a regular file: ${name}`); }
    catch(e) { if(e.code !== 'ENOENT') throw e; }
    return {file, name, text:fs.existsSync(file)?fs.readFileSync(file,'utf8'):''};
  });
  const guidance=fs.readFileSync(path.join(root,'templates/workspace-guidance.md'),'utf8');
  const changed=[];
  for(const {file,name,text} of targets){
    const marker=name==='AGENTS.md'?'<!-- ISP Block Maker working agreement v1 -->':'<!-- ISP Block Maker shared agreement -->';
    if(text.includes(marker)){
      if(name==='AGENTS.md'){
        const lines=guidance.split(/\r?\n/),context=lines.find(l=>l.startsWith('- **Establish context.')),board=lines.find(l=>l.startsWith('- **Keep the big picture'));
        let updated=text;
        for(const paragraph of legacyParagraphs)updated=updated.split(/(\r?\n)/).map(line=>line===paragraph?(paragraph.startsWith('- **Establish')?context:board):line).join('');
        if(updated!==text){
          const backup=file+'.isp-backup-'+Date.now();fs.writeFileSync(backup,text,{flag:'wx'});
          fs.writeFileSync(file,updated);changed.push(name);
        }
      }
      continue;
    }
    const addition=name==='AGENTS.md'?guidance:
      '<!-- ISP Block Maker shared agreement -->\nRead and follow `AGENTS.md` in this workspace for the shared working agreement, including optional board use and consistency when the task changes the big-picture structure. Resolve that path relative to this file. This applies to this workspace and its subdirectories.\n';
    fs.appendFileSync(file,'\n'+addition+'\n');changed.push(name);
  }
  return changed;
}
