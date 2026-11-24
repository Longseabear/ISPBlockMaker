import {z} from 'zod';
import {checkpointInput,attemptInput,updateInput} from './tracking.mjs';
import {payloadSchema} from './project-skills.mjs';
import {restructureSchema} from './job-restructure.mjs';
import {diagramSchema,graphSchema} from './model.mjs';

const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), revision=z.number().int().positive();
const target=z.object({kind:z.enum(['branch','commit','tag']),ref:z.string().min(1).max(250)});
const scope=block=>block?`/api/blocks/${block}`:'/api/global';
export function registerManagementTools(tool,api,mutate){
 const register=(name,description,schema,fn,destructive=false)=>tool(name,description,{request_id:z.string().uuid(),...schema},input=>mutate(name,input,()=>fn(input)),false,destructive);
 tool('get_project','Read all diagrams and global work. Prefer get_diagram for a bounded task.',{},()=>api('GET','/api/project'));
 tool('export_graph_mermaid','Export one explicit diagram as Mermaid.',{diagram_id:id},({diagram_id})=>api('GET',`/api/mermaid?format=json&diagramId=${diagram_id}`));
 register('migrate_graph_storage','Back up and migrate legacy block metadata to folders using the revision read.',{revision},({revision})=>api('POST','/api/graph-storage/migrate',{revision}),true);
 tool('export_harness','Read a reusable harness definition and its recipe/skill requirements.',{diagram_id:id},({diagram_id})=>api('GET',`/api/harness/export/${diagram_id}`));
 register('import_harness','Import a harness with fresh IDs, without execution. Review dependencies before starting.',{revision,bundle:z.object({format:z.literal('isp-harness'),version:z.literal(1),definition:z.object({diagram:diagramSchema,entry:z.string(),blocks:graphSchema.shape.blocks,edges:graphSchema.shape.edges}),requirements:z.object({recipes:z.array(z.string()),skills:z.array(z.string())}).optional()})},({request_id,...body})=>api('POST','/api/harness/import',body));
 tool('check_graph','Read-only source/graph consistency evidence. Review stale before using the result.',{blockId:id.optional(),changedFiles:z.array(z.string().min(1).max(1000)).max(200).default([])},input=>api('POST','/api/graph-check',input));
 tool('list_work_tracking','Read attempts, checkpoints, accepted result and current implementation.',{},()=>api('GET','/api/tracking'));
 register('create_work_attempt','Record an implementation attempt and baseline; does not execute work.',attemptInput.shape,({request_id,...body})=>api('POST','/api/attempts',body));
 register('update_work_attempt','Record actual attempt status and evidence. Use expectedUpdatedAt read from the attempt.',{attempt_id:id,...updateInput.shape},({request_id,attempt_id,...body})=>api('PATCH',`/api/attempts/${attempt_id}`,body));
 register('accept_work_attempt','Mark a completed result accepted only when requested. Does not restore source.',{attempt_id:id},({attempt_id})=>api('POST',`/api/attempts/${attempt_id}/accept`,{}),true);
 register('create_checkpoint','Snapshot implementation without changing Git staging.',checkpointInput.shape,({request_id,...body})=>api('POST','/api/checkpoints',body));
 tool('compare_checkpoints','Compare two saved implementation snapshots.',{from:id,to:id},({from,to})=>api('GET',`/api/checkpoints/compare?from=${from}&to=${to}`));
 tool('preview_checkpoint_restore','Inspect changes and get a current snapshot before restoring.',{checkpoint_id:id},({checkpoint_id})=>api('GET',`/api/checkpoints/${checkpoint_id}/preview`));
 register('restore_checkpoint','Restore the explicitly requested checkpoint after preview. Preserves current source and stops terminals. Requires the preview snapshot; stale previews are rejected.',{checkpoint_id:id,snapshot:z.string().min(1).max(1000),stopTerminals:z.literal(true)},({checkpoint_id,snapshot,stopTerminals})=>api('POST',`/api/checkpoints/${checkpoint_id}/restore`,{snapshot,stopTerminals}),true);
 tool('get_version_status','Inspect current Git version; optionally include history.',{history:z.boolean().default(false)},({history})=>api('GET',`/api/versions?history=${history?1:0}`));
 tool('get_commit_changes','Inspect files changed by a specific Git commit.',{hash:z.string().regex(/^[a-f0-9]{40,64}$/)},({hash})=>api('GET',`/api/versions/commits/${hash}`));
 tool('preview_version_switch','Resolve an explicit branch, commit or tag and inspect source changes before switching.',{target},({target})=>api('GET',`/api/versions/preview?${new URLSearchParams(target)}`));
 register('switch_version','Switch to a user-requested version after preview; stops terminals. Use hash and snapshot from the preview, never guessed values.',{target,hash:z.string().regex(/^[a-f0-9]{40,64}$/),snapshot:z.string().max(1000),stopTerminals:z.literal(true)},({request_id,...body})=>api('POST','/api/versions/switch',body),true);
 tool('list_user_requests','List pending or consumed user requests across blocks and global scope.',{status:z.enum(['pending','consumed','all']).default('pending'),block_id:id.optional()},({status,block_id})=>api('GET',`/api/requests?status=${status}${block_id?'&blockId='+block_id:''}`));
 register('consume_user_request','Consume a request only after implementation and validation; record concrete resolution. Omit block_id for global scope.',{revision,block_id:id.optional(),user_request_id:id,resolution:z.string().trim().min(1).max(12000)},({block_id,user_request_id,revision,resolution})=>api('POST',`${scope(block_id)}/requests/${user_request_id}/consume`,{revision,resolution}));
 register('split_user_request','Turn one pending request into pending JOBs without executing them. Omit block_id for global scope.',{revision,block_id:id.optional(),user_request_id:id,jobs:restructureSchema.shape.jobs},({block_id,user_request_id,revision,jobs})=>api('POST',`${scope(block_id)}/requests/${user_request_id}/jobs`,{revision,jobs}));
 register('restructure_jobs','Split one pending JOB into several, or merge several pending JOBs into one. Preserves request lineage; revision conflicts reject changes.',{block_id:id.optional(),mode:z.enum(['split','merge']),...restructureSchema.shape},({request_id,block_id,mode,...body})=>api('POST',`${scope(block_id)}/jobs/${mode}`,body),true);
 tool('list_project_skills','List editable project skills and read-only framework skills.',{},()=>api('GET','/api/skills'));
 tool('get_project_skill','Read a skill and its version hash before editing.',{name:payloadSchema.shape.name},({name})=>api('GET',`/api/skills/item/${name}`));
 register('save_project_skill','Create or update a project skill; version null means create, otherwise use the hash read. Framework skills are protected.',payloadSchema.shape,({request_id,...body})=>api('POST','/api/skills/save',body));
 register('delete_project_skill','Archive a project skill using its current version hash. Framework skills are protected.',{name:payloadSchema.shape.name,version:z.string().regex(/^[a-f0-9]{64}$/)},({name,version})=>api('DELETE',`/api/skills/item/${name}`,{version}),true);
}
