import test from 'node:test';
import assert from 'node:assert/strict';
import {zoomAround,visibleSource} from '../src/viewer-camera.ts';
test('zoom preserves the source pixel under the pointer, including margins',()=>{const offset={x:100,y:50},pointer={x:30,y:120};const next=zoomAround(offset,1,2,pointer);assert.deepEqual(next,{x:170,y:-20});assert.equal((pointer.x-next.x)/2,pointer.x-offset.x);assert.equal((pointer.y-next.y)/2,pointer.y-offset.y);});
test('free pan reports only visible source pixels, not surrounding margins',()=>{const area={x:400,y:200,width:800,height:600},preview={width:400,height:300},viewport={width:500,height:400};assert.deepEqual(visibleSource(area,preview,1,{x:50,y:50},viewport),area);assert.deepEqual(visibleSource(area,preview,2,{x:-100,y:-50},viewport),{x:500,y:250,width:500,height:400});assert.equal(visibleSource(area,preview,1,{x:600,y:0},viewport),null);});
