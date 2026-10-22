import crypto from 'node:crypto';

export async function retrieveContext({search,store,scope,input,maxChars}){
 const found=await search.search({...input,limit:input.limit||5},scope),graph=structuredClone(store.get());
 if(graph.revision!==found.revision)throw Error('Graph changed during retrieval; retry with current evidence');
 const result={generation:found.generation,revision:found.revision,total:found.total,results:[],blocks:[],edges:[],truncated:false};
 const fits=()=>JSON.stringify(result).length<=maxChars;
 const add=(key,value)=>{result[key].push(value);if(fits())return true;result[key].pop();result.truncated=true;return false;};
 for(const hit of found.results){
  if(add('results',hit))continue;
  // Retain valid JSON and correct line evidence while reducing the excerpt.
  let lo=0,hi=hit.excerpt.length,best=null;
  while(lo<=hi){const count=(lo+hi)>>1;let excerpt=hit.excerpt.slice(0,count);if(/[\uD800-\uDBFF]$/u.test(excerpt))excerpt=excerpt.slice(0,-1);
   const candidate={...hit,excerpt,end_line:hit.start_line+excerpt.split('\n').length-1,partial_last_line:true,truncated:true};
   result.results.push(candidate);const okay=fits();result.results.pop();if(okay){best=candidate;lo=count+1;}else hi=count-1;
  }
  if(best?.excerpt)add('results',best);
  break;
 }
 const seeds=new Set(found.results.flatMap(hit=>hit.block_ids||[hit.block_id]).filter(Boolean));
 const adjacent=graph.edges.filter(edge=>seeds.has(edge.source)||seeds.has(edge.target));
 const ids=[...new Set([...seeds,...adjacent.flatMap(edge=>[edge.source,edge.target])])];
 if(ids.length>8)result.truncated=true;
 for(const id of ids.slice(0,8)){
  const block=graph.blocks.find(b=>b.id===id);if(!block)continue;
  const {jobs,userRequests,...definition}=block;
  const hash=crypto.createHash('sha256').update(JSON.stringify(definition,null,2)).digest('hex');
  // Same access check and hash verification as ordinary document reads.
  await search.read({document_id:'block:'+id,hash,max_lines:1},scope);
  const contract=Object.fromEntries(Object.entries(block.agentContract||{}).map(([key,value])=>[key,String(value).slice(0,400)]));
  const truncated=Object.values(block.agentContract||{}).some(value=>String(value).length>400);
  add('blocks',{block_id:id,diagram_id:block.diagramId,name:block.name,relation:seeds.has(id)?'matched':'neighbor',document_id:'block:'+id,hash,field:'agentContract',inputs:block.inputs,outputs:block.outputs,contract,truncated});
  if(truncated)result.truncated=true;
 }
 const included=new Set(result.blocks.map(block=>block.block_id));
 for(const edge of adjacent)if(included.has(edge.source)&&included.has(edge.target))add('edges',edge);
 if(store.get().revision!==found.revision)throw Error('Graph changed during retrieval; retry with current evidence');
 result.truncated=result.truncated||result.results.some(hit=>hit.truncated);
 return result;
}
