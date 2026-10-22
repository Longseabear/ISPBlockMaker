import {z} from 'zod';
import {diagramSchema,blockSchema} from './model.mjs';
import {startHarness} from './harness-model.mjs';
import {graphOperationsSchema} from './graph-operations.mjs';

const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),request_id=z.string().uuid(),revision=z.number().int().positive();
export function registerEditTools(tool,api,mutate){
 const register=(name,description,schema,fn,destructive=false)=>tool(name,description,{request_id,...schema},input=>mutate(name,input,()=>fn(input)),false,destructive);
 register('edit_graph','Atomically add/remove blocks or connect/disconnect edges using stable IDs and the revision read. Removing connected edges requires explicit opt-in. No direct graph.json editing.',graphOperationsSchema.shape,({request_id,...body})=>api('POST','/api/graph/operations',body),true);
 register('create_diagram','Create a named pipeline or harness diagram. Supply the graph revision read and a unique request_id.',{revision,diagram:diagramSchema.strict()},({revision,diagram})=>api('POST','/api/diagrams',{revision,diagram}));
 register('update_diagram','Update a diagram by stable ID. Revision conflicts require reading and reconciling current state.',{revision,diagram_id:id,patch:diagramSchema.omit({id:true}).partial().strict()},({revision,diagram_id,patch})=>api('PATCH',`/api/diagrams/${diagram_id}`,{revision,patch}));
 register('delete_diagram','Delete an empty diagram. Existing blocks must be handled explicitly first; the server rejects deleting a nonempty or last diagram.',{revision,diagram_id:id},({revision,diagram_id})=>api('DELETE',`/api/diagrams/${diagram_id}`,{revision}),true);
 register('update_block','Update block metadata, contracts, ports or source references by stable ID. Omitted top-level fields are preserved. Nested objects such as agentContract must include all values to retain.',{revision,block_id:id,patch:blockSchema.omit({id:true,diagramId:true,userRequests:true,jobs:true}).partial().strict()},({revision,block_id,patch})=>api('PATCH',`/api/blocks/${block_id}`,{revision,patch}));
 register('start_harness','Start a manual or automatic harness run. Returns its run ID; disconnection does not cancel it. Read the diagram and check_harness before execution.',{revision,...startHarness.omit({revision:true,requestId:true}).shape},({request_id,...input})=>api('POST','/api/harness/runs',{...input,requestId:request_id}));
 register('control_harness','Control an explicit run using the version read. Pass/fail applies to the current waiting attempt; record is for external work in manual mode.',{run_id:id,version:z.number().int().nonnegative(),action:z.enum(['pause','stop','resume','pass','fail','mode','record']),attemptId:z.string().optional(),mode:z.enum(['automatic','manual']).optional(),outcome:z.enum(['pass','fail']).optional(),note:z.string().max(8000).default('')},({request_id,run_id,action,...body})=>api('POST',`/api/harness/runs/${run_id}/${action}`,body),true);
 tool('check_harness','Validate a harness definition and inspect its entry and steps without executing it.',{diagram_id:id},({diagram_id})=>api('GET',`/api/harness/check/${diagram_id}`));
}
