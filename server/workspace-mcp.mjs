import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {registerLocalTools} from './mcp-local-tools.mjs';
import {retrieveContext} from './retrieve-context.mjs';
import {registerEditTools} from './mcp-edit-tools.mjs';
import {registerWorkTools} from './mcp-work-tools.mjs';
import {registerArtifactTools} from './mcp-artifact-tools.mjs';
import {registerSharedImageTools} from './mcp-shared-images.mjs';

const searchFields={query:z.string().min(1).max(500),mode:z.enum(['all','any']).optional(),diagram_id:z.string().optional(),block_id:z.string().optional(),types:z.array(z.enum(['diagram','block','document','source','job'])).optional(),limit:z.number().int().min(1).max(50).optional(),offset:z.number().int().min(0).max(10000).optional()};
export function createWorkspaceMcp({store,search,scope={},localApi,mutate,readArtifact,sharedImages}){
 const server=new McpServer({name:'isp-workspace',version:'1.0.0'});
 const tool=(name,description,inputSchema,fn,readOnly=true,destructive=false)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:destructive,openWorldHint:false}},async input=>{
  try{const result=await fn(input),value=result&&typeof result==='object'&&!Array.isArray(result)?result:{result};return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
  catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
 });
 tool('list_diagrams','List diagram IDs and roles. Use explicit IDs for subsequent requests.',{},()=>{const p=store.get();return {revision:p.revision,diagrams:p.diagrams.map(d=>({id:d.id,name:d.name,kind:d.kind,description:d.overview.description}))};});
 tool('search_workspace','Search Board descriptions and documents with BM25. Quotes select phrases. Results include source excerpts and content hashes.',searchFields,input=>search.search(input,scope));
 tool('count_matches','Count matching indexed documents, grouped by type and diagram within the same access scope. Counts are documents, not term occurrences.',searchFields,async input=>{const {total,counts,generation,revision}=await search.search({...input,limit:1,offset:0},scope);return {total,counts,generation,revision};});
 tool('read_document','Read a bounded document section. Supply the hash from search to reject stale evidence.',{document_id:z.string(),hash:z.string().optional(),start_line:z.number().int().min(1).optional(),max_lines:z.number().int().min(1).max(200).optional()},input=>search.read(input,scope));
 tool('retrieve_context','Retrieve original evidence plus matching blocks and immediate neighbor I/O contracts. max_chars bounds the complete JSON result. Truncation is explicit; this tool does not generate an answer.',{...searchFields,max_chars:z.number().int().min(1000).max(24000).default(12000)},({max_chars,...input})=>retrieveContext({search,store,scope,input,maxChars:max_chars}));
 if(localApi&&!scope.public)registerLocalTools(tool,localApi,mutate);
 if(localApi&&mutate&&!scope.public)registerEditTools(tool,localApi,mutate);
 if(localApi&&mutate&&!scope.public)registerWorkTools(tool,localApi,mutate);
 if(localApi&&mutate&&readArtifact&&!scope.public)registerArtifactTools(tool,{api:localApi,mutate,readFile:readArtifact,artifacts:()=>store.get().artifacts});
 if(scope.public&&scope.imageIds?.length&&sharedImages)registerSharedImageTools(server,{scope,...sharedImages});
 return server;
}
export function workspaceMcpHandler(context){return async(req,res)=>{
 const server=createWorkspaceMcp(context()),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 const cleanup=()=>{void transport.close();void server.close();};res.once('close',cleanup);
 try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}
 catch(e){if(!res.headersSent)res.status(500).json({jsonrpc:'2.0',id:null,error:{code:-32603,message:'MCP request failed'}});}
 };}
