import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {navigationShortcut, nextNavigationIndex, performNavigationShortcut, installNavigationShortcuts} from '../src/navigation-shortcuts.ts';
import {withReportNavigation} from '../server/report-navigation.mjs';

const key = (name, extra={}) => ({key:name,altKey:true,ctrlKey:false,metaKey:false,shiftKey:false,isComposing:false,...extra});
test('navigation chords exclude normal typing, shell controls, AltGr and composition', () => {
  for (let n=1;n<=5;n++) assert.equal(navigationShortcut(key(String(n))),`view:${n-1}`);
  assert.equal(navigationShortcut(key('ArrowLeft')),'view:previous');
  assert.equal(navigationShortcut(key('PageDown')),'terminal:next');
  for (const extra of [{altKey:false},{ctrlKey:true},{metaKey:true},{shiftKey:true},{isComposing:true}]) assert.equal(navigationShortcut(key('1',extra)),null);
  for (const name of ['c','v','Enter','Tab','6']) assert.equal(navigationShortcut(key(name)),null);
});
test('tabs wrap in both directions, including absent selection and empty lists', () => {
  assert.equal(nextNavigationIndex(3,2,1),0);
  assert.equal(nextNavigationIndex(3,0,-1),2);
  assert.equal(nextNavigationIndex(3,-1,1),0);
  assert.equal(nextNavigationIndex(3,-1,-1),2);
  assert.equal(nextNavigationIndex(0,-1,1),-1);
});
test('navigation uses existing click guards and captures terminal keys before input', () => {
  const oldDocument=globalThis.document,oldWindow=globalThis.window;
  const calls=[],listeners=new Map();let dialog=false;
  globalThis.document={querySelector:selector=>selector.startsWith('[role=')?(dialog?{}:null):{click:()=>calls.push(selector),getAttribute:()=>null}};
  globalThis.window={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  try {
    const dispose=installNavigationShortcuts();
    const event={...key('3'),preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    listeners.get('keydown')(event);
    assert.ok(event.prevented&&event.stopped);
    assert.match(calls[0],/Visualizations/);
    listeners.get('keydown')({...event,repeat:true});assert.equal(calls.length,1);
    dialog=true;listeners.get('keydown')(event);assert.equal(calls.length,1);
    performNavigationShortcut('terminal:kill');performNavigationShortcut({});assert.equal(calls.length,1);
    dispose();assert.equal(listeners.size,0);
  } finally {globalThis.document=oldDocument;globalThis.window=oldWindow;}
});
test('sandbox report bridge preserves doctype and forwards only navigation chords', () => {
  const original='<!DOCTYPE html><html><head><title>Report</title></head><body>content</body></html>';
  const result=withReportNavigation(original);
  assert.ok(result.startsWith('<!DOCTYPE html><script>'));
  assert.equal(result.replace(/<script>[\s\S]*?<\/script>/,''),original);
  const messages=[];let listener;
  vm.runInNewContext(result.match(/<script>([\s\S]*?)<\/script>/)[1],{window:{addEventListener:(_,fn)=>listener=fn},parent:{postMessage:message=>messages.push(message)}});
  const event={...key('PageUp'),preventDefault(){},stopImmediatePropagation(){}};
  listener(event);assert.equal(messages[0].action,'terminal:previous');
  listener({...event,repeat:true});listener({...event,ctrlKey:true});assert.equal(messages.length,1);
});

test('terminal navigation prefers focused panel and ignores hidden sessions', () => {
  const previous={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,requestAnimationFrame:globalThis.requestAnimationFrame};
  const clicked=[];
  const panel=(name,visible,focused)=>({getClientRects:()=>visible?[{}]:[],contains:()=>focused,querySelector:()=>null,querySelectorAll:()=>[0,1].map(index=>({getAttribute:()=>index===0?'true':'false',click:()=>clicked.push(name+index),focus(){}}))});
  const hub=panel('hub',true,false),shell=panel('shell',true,true),hidden=panel('hidden',false,true);
  globalThis.document={activeElement:{},querySelectorAll:()=>[hidden,hub,shell]};
  globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis.requestAnimationFrame=fn=>fn();
  try {
    performNavigationShortcut('terminal:next');assert.deepEqual(clicked,['shell1']);
    shell.contains=()=>false;
    performNavigationShortcut('terminal:previous');assert.deepEqual(clicked,['shell1','hub1']);
  } finally {Object.assign(globalThis,previous);}
});
