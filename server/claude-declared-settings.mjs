import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
// Display declarations only. The CLI remains authoritative for policy and precedence.
export async function claudeDeclaredSettings(workspace,env=process.env){
 const entries=[];
 for(const [source,file] of [['user',path.join(env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'settings.json')],['project',path.join(workspace,'.claude','settings.json')],['local',path.join(workspace,'.claude','settings.local.json')]]){
  try{const value=JSON.parse(await fs.readFile(file,'utf8'));const model=value.model||value.env?.ANTHROPIC_MODEL;const permissionMode=value.permissions?.defaultMode;const effort=value.effortLevel||value.env?.CLAUDE_CODE_EFFORT_LEVEL;
   const safe=v=>typeof v==='string'&&v.length<=200?v:undefined;
   if(model||permissionMode||effort)entries.push({source,model:safe(model),permissionMode:safe(permissionMode),effort:safe(effort)});
  }catch(error){if(error.code!=='ENOENT')entries.push({source,error:'설정 파일을 읽지 못했습니다'});}
 }
 if(env.ANTHROPIC_MODEL||env.CLAUDE_CODE_EFFORT_LEVEL)entries.push({source:'environment',model:env.ANTHROPIC_MODEL,effort:env.CLAUDE_CODE_EFFORT_LEVEL});
 return entries;
}
