import crypto from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareMcpLaunch} from '../server/mcp-settings.mjs';

export async function runAgent(agent,args,env=process.env){
 if(!['claude','codex'].includes(agent))throw Error('Choose claude or codex');
 if(!env.ISP_WORKSPACE||!env.ISP_API_URL||!env.ISP_API_TOKEN)throw Error('Open a new ISP terminal to initialize its MCP connection');
 const workspace=path.resolve(env.ISP_WORKSPACE),relative=path.relative(workspace,process.cwd());
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Run this agent inside its ISP workspace');
 // Resolve the real executable without recursing into our PATH launchers.
 // Each direct CLI process initializes a fresh external MCP identity.
 const launchEnv={...env,PATH:env.ISP_AGENT_ORIGINAL_PATH||env.PATH};
 delete launchEnv.Path;delete launchEnv.ISP_MCP_AGENT_TOKEN;
 const prepared=prepareMcpLaunch(workspace,agent,crypto.randomUUID(),launchEnv);
 try{
  return await new Promise((resolve,reject)=>{
   const child=spawn(prepared.launch.command,[...prepared.launch.args,...args],{env:launchEnv,stdio:'inherit',windowsHide:true});
   const interrupt=()=>{}; // The foreground console also delivers Ctrl+C to the child.
   process.on('SIGINT',interrupt);
   const cleanup=()=>process.off('SIGINT',interrupt);
   child.once('error',error=>{cleanup();reject(error);});
   child.once('exit',(code)=>{cleanup();resolve(code??1);});
  });
 }finally{prepared.cleanup();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=await runAgent(process.argv[2],process.argv.slice(3));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
