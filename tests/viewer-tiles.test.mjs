import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {imageTile} from '../server/viewer-analysis.mjs';import {openImage} from '../server/viewer-image.mjs';
import {visibleTiles,paddedTile} from '../src/viewer-tiles.ts';
test('visible tiles cover exact source coordinates, cross boundaries, and keep neighbor halo',()=>{
 const area={x:0,y:0,width:8000,height:6000},preview={width:1200,height:900};
 assert.equal(visibleTiles(area,preview,1,{x:0,y:0},{width:900,height:600}).length,0);
 const tiles=visibleTiles(area,preview,20,{x:-1500,y:-1500},{width:150,height:150});
 assert.deepEqual(tiles.map(t=>[t.x,t.y]),[[0,0],[512,0],[0,512],[512,512]]);
 assert.deepEqual(paddedTile(tiles[3],area),{x:496,y:496,width:544,height:544});
 const edge=visibleTiles(area,preview,20,{x:-23910,y:-17910},{width:120,height:120});
 assert.equal(edge.length,1);assert.deepEqual(paddedTile(edge[0],area),{x:7664,y:5616,width:336,height:384});
});
test('binary RAW tiles preserve aligned 10/12/16bit values and read only requested scanlines',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-tiles-')),file=path.join(dir,'raw');
 try{for(const bitDepth of [10,12,16])for(const alignment of ['lsb','msb']){
  const spec={format:'raw',width:8000,height:6000,bitDepth,alignment,offset:8,stride:16004,pattern:'GRBG',group:4};
  fs.writeFileSync(file,Buffer.alloc(8));fs.truncateSync(file,8+16004*6000);const fd=fs.openSync(file,'r+');const row=Buffer.alloc(6);[1,511,2**bitDepth-1].forEach((v,i)=>row.writeUInt16LE(alignment==='msb'?v*2**(16-bitDepth):v,i*2));fs.writeSync(fd,row,0,6,8+5999*16004+7997*2);fs.closeSync(fd);
  const original=fs.readSync;let count=0;let tile;
  try{fs.readSync=(...args)=>{count+=args[3];return original(...args);};tile=imageTile(file,{id:'raw',spec},{x:7997,y:5999,width:3,height:1});}finally{fs.readSync=original;}
  assert.equal(count,6);assert.equal(tile.metadata.encoding,'r16le');assert.deepEqual([0,1,2].map(i=>tile.bytes.readUInt16LE(i*2)),[1,511,2**bitDepth-1]);
  assert.throws(()=>imageTile(file,{id:'raw',spec},{x:0,y:0,width:577,height:1}),/576/);
 }}finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
});
test('BMP tiles preserve top-down RGB coordinates for palette, 24bit and 32bit storage',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-tiles-bmp-')),file=path.join(dir,'bmp');
 try{for(const bits of [8,24,32])for(const bottomUp of [true,false]){
  const w=7,h=4,stride=Math.ceil(w*bits/32)*4,offset=54+(bits===8?1024:0),bytes=Buffer.alloc(offset+stride*h);bytes.write('BM');bytes.writeUInt32LE(offset,10);bytes.writeUInt32LE(40,14);bytes.writeInt32LE(w,18);bytes.writeInt32LE(bottomUp?h:-h,22);bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(bits,28);
  if(bits===8)for(let i=0;i<256;i++)bytes.set([i,255-i,30,0],54+i*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=offset+(bottomUp?h-1-y:y)*stride+x*bits/8;if(bits===8)bytes[p]=x+y*10;else bytes.set([x,y,30],p);}
  fs.writeFileSync(file,bytes);const image=openImage(bytes,{format:'bmp'}),area={x:4,y:2,width:3,height:2};const tile=imageTile(file,{id:'bmp',spec:image.spec},area);
  for(let y=0;y<2;y++)for(let x=0;x<3;x++)assert.deepEqual([...tile.bytes.subarray((y*3+x)*4,(y*3+x+1)*4)],image.rgba(x+4,y+2));
 }
 const rgba=Buffer.from([1,2,3,4,5,6,7,8]);fs.writeFileSync(file,rgba);assert.deepEqual(imageTile(file,{id:'rgba',spec:{format:'rgba8',width:2,height:1}},{x:0,y:0,width:2,height:1}).bytes,rgba);
 }finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
});
