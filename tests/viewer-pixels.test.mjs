import test from 'node:test';
import assert from 'node:assert/strict';
import {visiblePixelGrid,cfaPixelChannel,validPixelSamples} from '../src/viewer-pixels.ts';

const image={id:'raw-1',spec:{format:'raw',width:8000,height:6000,bitDepth:12,pattern:'GRBG',group:1}};
test('numeric overlay threshold is based on original pixels, not thumbnail zoom',()=>{
  const preview={width:1000,height:750,area:{x:0,y:0,width:8000,height:6000}};
  assert.equal(visiblePixelGrid(image,preview,32,{x:0,y:0},{width:800,height:600}),null);
  const actual=visiblePixelGrid(image,preview,256,{x:-33,y:-1},{width:800,height:600});
  assert.deepEqual(actual,{area:{x:1,y:0,width:26,height:19},cellWidth:32,cellHeight:32});
});
test('physical viewport clipping includes partially visible cells and excludes margins',()=>{
  const preview={width:200,height:100,area:{x:100,y:200,width:200,height:100}};
  assert.deepEqual(visiblePixelGrid(image,preview,32,{x:12,y:-33},{width:100,height:100})?.area,{x:100,y:201,width:3,height:4});
  assert.equal(visiblePixelGrid(image,preview,32,{x:200,y:0},{width:100,height:100}),null);
  assert.deepEqual(visiblePixelGrid(image,{width:2,height:2,area:{x:7998,y:5998,width:2,height:2}},32,{x:-1,y:-1},{width:100,height:100})?.area,{x:7998,y:5998,width:2,height:2});
});
test('large viewports never request more than bounded physical samples',()=>{
  assert.equal(visiblePixelGrid(image,{width:8000,height:6000,area:{x:0,y:0,width:8000,height:6000}},32,{x:0,y:0},{width:4000,height:4000}),null);
});
test('RGB uses a larger readability threshold for three values per pixel',()=>{
  const rgb={id:'rgb',spec:{format:'bmp',width:200,height:100,bitDepth:8}},preview={width:200,height:100,area:{x:0,y:0,width:200,height:100}};
  assert.equal(visiblePixelGrid(rgb,preview,32,{x:0,y:0},{width:800,height:600}),null);
  assert.deepEqual(visiblePixelGrid(rgb,preview,40,{x:0,y:0},{width:80,height:80})?.area,{x:0,y:0,width:2,height:2});
});
test('channel hints preserve Bayer, Tetra and imported CFA phase',()=>{
  assert.equal(cfaPixelChannel(image.spec,0,0),'G');assert.equal(cfaPixelChannel(image.spec,1,0),'R');assert.equal(cfaPixelChannel(image.spec,0,1),'B');
  const tetra={...image.spec,group:2};assert.equal(cfaPixelChannel(tetra,1,1),'G');assert.equal(cfaPixelChannel(tetra,2,1),'R');
  const square={...image.spec,group:4,originX:3,originY:4};assert.equal(cfaPixelChannel(square,0,0),'B');assert.equal(cfaPixelChannel(square,1,0),'G');
});
test('payload validation rejects stale ids, wrong rectangles and transformed values',()=>{
  const area={x:0,y:0,width:2,height:1},payload={imageId:image.id,area,channels:1,sampleType:'raw',values:[0,4095]};
  assert.equal(validPixelSamples(payload,image,area),true);
  for(const change of [{imageId:'other'},{area:{...area,x:1}},{values:[0]},{values:[0,4096]},{values:[0,.5]},{channels:3},{sampleType:'rgb'}])assert.equal(validPixelSamples({...payload,...change},image,area),false);
  const rgb={id:'rgb',spec:{format:'bmp',width:2,height:1,bitDepth:8}};
  assert.equal(validPixelSamples({imageId:'rgb',area,channels:3,sampleType:'rgb',values:[255,0,10,32,65,90]},rgb,area),true);
});
