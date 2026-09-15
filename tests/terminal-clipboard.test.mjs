import test from "node:test";
import assert from "node:assert/strict";
import {terminalClipboardHandler} from "../src/terminal-clipboard.ts";

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function key(extra={}) {return {key:"v",type:"keydown",ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,repeat:false,preventDefault(){this.prevented=true;},stopPropagation(){},...extra};}
test("terminal paste shortcuts deliver Unicode and multiline text exactly once",async()=>{
 for(const combo of [{shiftKey:true},{ctrlKey:false,metaKey:true,shiftKey:true},{key:"Insert",ctrlKey:false,shiftKey:true}]){
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
 handler(key({shiftKey:true}));await tick();assert.equal(errors.length,1);
 ready=false;handler(key({shiftKey:true}));await tick();assert.equal(reads,1);assert.equal(errors.length,2);
});

test("native paste stays available and selected Ctrl+C copies without interrupting",async()=>{
 const copied=[];let selection="selected output",all=0;
 const handler=terminalClipboardHandler({readText:assert.fail,paste:assert.fail,ready:()=>true,error:assert.fail,selection:()=>selection,writeText:async text=>{copied.push(text);},selectAll:()=>all++});
 const paste=key();assert.equal(handler(paste),false);assert.equal(paste.prevented,undefined);
 const copy=key({key:"c"});assert.equal(handler(copy),false);assert.equal(copy.prevented,undefined);await tick();assert.deepEqual(copied,[]);
 const insert=key({key:"Insert"});assert.equal(handler(insert),false);assert.equal(insert.prevented,undefined);
 handler(key({key:'c',shiftKey:true}));await tick();assert.deepEqual(copied,[selection]);
 selection="";assert.equal(handler(key({key:"c"})),true);assert.equal(handler(key({key:"c",shiftKey:true})),false);
 handler(key({key:"a",shiftKey:true}));assert.equal(all,1);
});

test('Ctrl+Shift+C uses the native copy command before permission-based fallback',()=>{
 let copies=0;
 const handler=terminalClipboardHandler({readText:assert.fail,paste:assert.fail,ready:()=>true,error:assert.fail,selection:()=> 'selected text',writeText:assert.fail,copySelection:()=>{copies++;return true;}});
 const event=key({key:'c',shiftKey:true});assert.equal(handler(event),false);assert.equal(event.prevented,true);assert.equal(copies,1);
 handler(key({key:'c',shiftKey:true,repeat:true}));handler(key({key:'c',shiftKey:true,type:'keyup'}));assert.equal(copies,1);
});
