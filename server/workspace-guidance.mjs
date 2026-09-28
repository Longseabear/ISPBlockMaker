import fs from 'node:fs';
import path from 'node:path';

// Add our entry guidance once; user-owned text, including edited agreements,
// remains authoritative and is never replaced by an installer refresh.
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
    if(text.includes(marker))continue;
    const addition=name==='AGENTS.md'?guidance:
      '<!-- ISP Block Maker shared agreement -->\nRead and follow `AGENTS.md` in this workspace for the shared working agreement, including graph reconciliation at implementation/validation milestones. Resolve that path relative to this file. This applies to this workspace and its subdirectories.\n';
    fs.appendFileSync(file,'\n'+addition+'\n');changed.push(name);
  }
  return changed;
}
