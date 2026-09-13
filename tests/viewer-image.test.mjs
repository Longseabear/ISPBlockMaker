import test from "node:test";
import assert from "node:assert/strict";
import {inflateSync} from "node:zlib";
import {openImage,channelAt,cropImage,preview} from "../server/viewer-image.mjs";

test("RAW crop preserves 16-bit source bytes, padding and CFA phase across repeat crops",()=>{
 const bytes=Buffer.alloc(4+20*8,0xee);
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)bytes.writeUInt16LE((y*8+x)|0xa000,4+y*20+x*2);
 const image=openImage(bytes,{format:"raw",width:8,height:8,bitDepth:12,offset:4,stride:20,pattern:"GRBG",group:2});
 assert.equal(image.sample(3,2),19);
 const crop=cropImage(image,{x:1,y:3,width:4,height:3});
 assert.equal(crop.bytes.length,24);assert.equal(crop.bytes.readUInt16LE(),0xa019);
 assert.deepEqual(crop.spec.cfaOrigin,{x:1,y:3});
 const again=openImage(crop.bytes,crop.spec);
 for(let y=0;y<3;y++)for(let x=0;x<4;x++){assert.equal(again.sample(x,y),image.sample(x+1,y+3));assert.equal(channelAt(again.spec,x,y),channelAt(image.spec,x+1,y+3));}
 const next=cropImage(again,{x:1,y:1,width:2,height:2});assert.deepEqual(next.spec.cfaOrigin,{x:2,y:0});
 assert.throws(()=>cropImage(image,{x:7,y:0,width:2,height:1}),/ROI/);
 assert.throws(()=>openImage(Buffer.alloc(2),{format:"raw",width:8,height:8}),/부족/);
});
test("10/12bit alignment and Bayer/Tetra/TetraSquare layouts are explicit",()=>{
 for(const depth of [10,12]){const bytes=Buffer.alloc(8);bytes.writeUInt16LE((2**depth-1)<<(16-depth));assert.equal(openImage(bytes,{format:"raw",width:2,height:2,bitDepth:depth,alignment:"msb"}).sample(0,0),2**depth-1);}
 for(const group of [1,2,4])for(const pattern of ["GRBG","RGGB","GBRG","BGGR"]){const s={group,pattern};assert.equal(channelAt(s,0,0),pattern[0]);assert.equal(channelAt(s,group,0),pattern[1]);assert.equal(channelAt(s,0,group),pattern[2]);assert.equal(channelAt(s,group,group),pattern[3]);}
});
test("BMP bottom-up rows decode to top-left coordinates and PNG crops contain exact RGB",()=>{
 const bytes=Buffer.alloc(70);bytes.write("BM");bytes.writeUInt32LE(54,10);bytes.writeUInt32LE(40,14);bytes.writeInt32LE(2,18);bytes.writeInt32LE(2,22);bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(24,28);
 bytes.set([255,0,0,255,255,255],54);bytes.set([0,0,255,0,255,0],62);
 const image=openImage(bytes,{format:"bmp"});assert.deepEqual(image.rgba(0,0),[255,0,0,255]);assert.deepEqual(image.rgba(0,1),[0,0,255,255]);
 const crop=cropImage(image,{x:0,y:0,width:1,height:2});assert.equal(crop.extension,"png");
 const png=crop.bytes;let data;for(let p=8;p<png.length;){const n=png.readUInt32BE(p);if(png.toString("ascii",p+4,p+8)==="IDAT")data=png.subarray(p+8,p+8+n);p+=n+12;}
 assert.deepEqual([...inflateSync(data)],[0,255,0,0,255,0,0,0,255,255]);
 assert.throws(()=>preview(image,{black:10,white:10}),/White/);
});
