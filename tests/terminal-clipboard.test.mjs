import test from "node:test";
import assert from "node:assert/strict";
import {terminalClipboardHandler} from "../src/terminal-clipboard.ts";

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function key(extra={}) {return {key:"v",type:"keydown",ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,repeat:false,preventDefault(){this.prevented=true;},stopPropagation(){},...extra};}
test("terminal paste shortcuts deliver Unicode and multiline text exactly once",async()=>{
 for(const combo of [{},{shiftKey:true},{ctrlKey:false,metaKey:true},{key:"Insert",ctrlKey:false,shiftKey:true}]){
  const pasted=[];let reads=0;
  const handler=terminalClipboardHandler({readText:async()=>{reads++;return "한글\nsecond line";},paste:text=>pasted.push(text),ready:()=>true,error:assert.fail});
  const event=key(combo);assert.equal(handler(event),false);assert.equal(event.prevented,true);
  handler(key({...combo,repeat:true}));handler(key({...combo,type:"keyup"}));await tick();
  assert.equal(reads,1);assert.deepEqual(pasted,["한글\nsecond line"]);
  assert.equal(handler(key({key:"c"})),true);
 }
});
test("clipboard denial and disconnected terminals report errors without sending input",async()=>{
 const errors=[];let reads=0;let ready=true;
 const handler=terminalClipboardHandler({readText:async()=>{reads++;throw Error("denied");},paste:assert.fail,ready:()=>ready,error:e=>errors.push(e)});
 handler(key());await tick();assert.equal(errors.length,1);
 ready=false;handler(key());await tick();assert.equal(reads,1);assert.equal(errors.length,2);
});
