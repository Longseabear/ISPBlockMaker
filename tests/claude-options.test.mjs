import test from 'node:test';import assert from 'node:assert/strict';import {sdkClaudeOptions} from '../server/claude-options.mjs';
test('explicit modes and effort map to SDK fields while workspace default adds no overrides',()=>{
 assert.deepEqual(sdkClaudeOptions(),{});
 for(const effort of ['low','medium','high','xhigh','max'])assert.equal(sdkClaudeOptions({effort}).effort,effort);
 for(const permissionMode of ['default','acceptEdits','plan','dontAsk','auto','bypassPermissions']){const o=sdkClaudeOptions({permissionMode});assert.equal(o.permissionMode,permissionMode);assert.equal(o.allowDangerouslySkipPermissions,permissionMode==='bypassPermissions'?true:undefined);}
 assert.throws(()=>sdkClaudeOptions({permissionMode:'unknown'}));assert.throws(()=>sdkClaudeOptions({settings:{}}));
});
