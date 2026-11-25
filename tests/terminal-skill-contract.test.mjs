import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {z} from 'zod';
import {registerTerminalTools} from '../server/mcp-terminal-tools.mjs';

test('published terminal skill calls validate against the actual MCP inputs and API mapping',async()=>{
 const tools=new Map(),calls=[];
 registerTerminalTools((name,description,shape,run)=>tools.set(name,{schema:z.object(shape).strict(),run}),async(...args)=>{calls.push(args);return {};});
 const skill=fs.readFileSync(new URL('../templates/project/.agents/skills/isp-shared-terminal/SKILL.md',import.meta.url),'utf8');
 const examples=[...skill.matchAll(/^\{"tool":.+$/gm)].map(match=>JSON.parse(match[0]));
 assert.equal(examples.length,4);assert.equal(tools.has('handoff_shared_terminal'),false);
 for(const example of examples){const tool=tools.get(example.tool);assert.ok(tool);await tool.run(tool.schema.parse(example.arguments));}
 assert.equal(calls[1][2].controlVersion,0);assert.equal(calls[1][2].requestId,examples[1].arguments.request_id);
 assert.equal(calls[1][2].data,'ssh build-host\r');
 assert.equal(calls[3][2].reason,'input');
});
