import {z} from 'zod';
export const claudeOptionsSchema=z.object({
 model:z.string().trim().max(200).default(''),
 effort:z.enum(['','low','medium','high','xhigh','max']).default(''),
 permissionMode:z.enum(['','default','acceptEdits','plan','dontAsk','auto','bypassPermissions']).default(''),
}).strict();
export function sdkClaudeOptions(value={}){
 const o=claudeOptionsSchema.parse(value);
 return {...(o.model?{model:o.model}:{}),...(o.effort?{effort:o.effort}:{}),...(o.permissionMode?{permissionMode:o.permissionMode}:{}),...(o.permissionMode==='bypassPermissions'?{allowDangerouslySkipPermissions:true}:{})};
}
