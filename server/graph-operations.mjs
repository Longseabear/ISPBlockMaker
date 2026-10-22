import {z} from 'zod';
import {blockSchema,graphSchema} from './model.mjs';
const id=blockSchema.shape.id;
export const graphOperationsSchema=z.object({
 revision:z.number().int().positive(),
 operations:z.array(z.discriminatedUnion('action',[
  z.object({action:z.literal('add_block'),block:blockSchema.omit({jobs:true,userRequests:true}).strict()}).strict(),
  z.object({action:z.literal('remove_block'),block_id:id,remove_connected_edges:z.boolean().default(false)}).strict(),
  z.object({action:z.literal('connect'),edge:graphSchema.shape.edges.element.strict()}).strict(),
  z.object({action:z.literal('disconnect'),edge_id:id}).strict(),
 ])).min(1).max(200),
}).strict();

export function applyGraphOperations(store,raw){
 const input=graphOperationsSchema.parse(raw),current=store.get();
 if(current.revision!==input.revision)throw Error('revision conflict: read and reconcile current graph');
 const graph=structuredClone(current);
 for(const op of input.operations){
  if(op.action==='add_block'){
   if(graph.blocks.some(b=>b.id===op.block.id))throw Error('Block ID already exists');
   graph.blocks.push({...op.block,userRequests:[],jobs:[]});
  }else if(op.action==='remove_block'){
   if(!graph.blocks.some(b=>b.id===op.block_id))throw Error('Block not found');
   const connected=graph.edges.filter(e=>e.source===op.block_id||e.target===op.block_id);
   if(connected.length&&!op.remove_connected_edges)throw Error('Block has connected edges; explicitly set remove_connected_edges to remove them');
   graph.blocks=graph.blocks.filter(b=>b.id!==op.block_id);graph.edges=graph.edges.filter(e=>!connected.includes(e));
  }else if(op.action==='connect'){
   if(graph.edges.some(e=>e.id===op.edge.id))throw Error('Edge ID already exists');
   graph.edges.push(op.edge);
  }else{
   if(!graph.edges.some(e=>e.id===op.edge_id))throw Error('Edge not found');
   graph.edges=graph.edges.filter(e=>e.id!==op.edge_id);
  }
 }
 // Existing store validation and persistence commit all operations together.
 const saved=store.graph(graph,input.revision);
 return {revision:saved.revision,operations:input.operations.map(op=>({action:op.action,id:op.block?.id||op.block_id||op.edge?.id||op.edge_id}))};
}
