import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runClaude} from '../server/claude-interaction.mjs';
import {readChatFile} from '../server/chat-files.mjs';

test('company command output, menu and tool inputs survive the SDK adapter',async t=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'isp-cloudcli-'));
 t.after(()=>fs.rm(workspace,{recursive:true,force:true}));
 const chat={id:'test',items:[],busy:true};let supplied;
 const run=runClaude({workspace,env:{},chat,text:'/init',runtime:{file:'C:/company/claude.exe'},save:async()=>{},ask:()=>{},cancelPrompts:()=>{},queryImpl:({prompt,options})=>{
  supplied={prompt,options};return (async function*(){
   yield {type:'system',subtype:'init',slash_commands:['init','compact','exit'],terminal_slash_commands:['exit']};
   yield {type:'assistant',message:{id:'tool',content:[{type:'tool_use',id:'read-1',name:'Read',input:{file_path:'project/main.py'}}]}};
   yield {type:'system',subtype:'local_command_output',uuid:'local',content:'Project instructions initialized.'};
  })();
 }});
 await run.done;
 assert.equal(supplied.prompt,'/init');assert.equal(supplied.options.pathToClaudeCodeExecutable,'C:/company/claude.exe');
 assert.deepEqual(supplied.options.settingSources,['user','project','local']);
 assert.deepEqual(chat.commands,['init','compact']);assert.equal(chat.items.find(i=>i.id==='read-1').input.file_path,'project/main.py');
 assert.equal(chat.items.find(i=>i.id==='local').text,'Project instructions initialized.');assert.equal(chat.status,'completed');
});

test('file previews reject outside paths, directories, binary and oversized files',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'isp-chat-files-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const workspace=path.join(dir,'workspace');await fs.mkdir(workspace);
 await fs.writeFile(path.join(workspace,'script.py'),'print("hello")');await fs.writeFile(path.join(dir,'outside.txt'),'secret');
 assert.equal((await readChatFile(workspace,'script.py')).content,'print("hello")');
 await assert.rejects(()=>readChatFile(workspace,'../outside.txt'),/워크스페이스/);
 await assert.rejects(()=>readChatFile(workspace,'.'),/1MB/);
 await fs.writeFile(path.join(workspace,'binary'),Buffer.from([0,1,2]));await assert.rejects(()=>readChatFile(workspace,'binary'),/바이너리/);
 await fs.writeFile(path.join(workspace,'large.txt'),Buffer.alloc(1024*1024+1,65));await assert.rejects(()=>readChatFile(workspace,'large.txt'),/1MB/);
 await fs.symlink(dir,path.join(workspace,'junction'),'junction');await assert.rejects(()=>readChatFile(workspace,'junction/outside.txt'),/워크스페이스/);
});

test('browser package cannot pull in agent, native server or Electron runtimes',async()=>{
 const pkg=JSON.parse(await fs.readFile(new URL('../vendor/cloudcli/package.json',import.meta.url),'utf8'));
 const names=Object.keys({...pkg.dependencies,...pkg.devDependencies});
 assert.equal(names.some(n=>/claude-agent-sdk|@openai|electron|node-pty|sqlite|express|bcrypt/.test(n)),false);
 const lock=JSON.parse(await fs.readFile(new URL('../vendor/cloudcli/package-lock.json',import.meta.url),'utf8'));
 assert.equal(Object.keys(lock.packages).some(n=>/node_modules\/(?:electron|@anthropic-ai|@openai)\//.test(n)),false);
});
