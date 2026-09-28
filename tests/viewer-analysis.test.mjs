import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openImage,encodePng} from '../server/viewer-image.mjs';
import {imagePixels,imageStatistics,combineStatistics,cfaChannel,MAX_STAT_SAMPLES} from '../server/viewer-analysis.mjs';

function fixture(bytes,spec,run) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-pixels-')),file=path.join(dir,'image.bin');
  fs.writeFileSync(file,bytes);
  try{return run(file,{id:'image',spec:spec.format==='png'?spec:openImage(bytes,spec).spec});}finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('Pixel grids decode exact 10/12-bit LSB/MSB words, stride and offset without rendering transforms',()=>{
  for(const bitDepth of [10,12])for(const alignment of ['lsb','msb']){
    const spec={format:'raw',width:8,height:6,bitDepth,alignment,offset:7,stride:22,pattern:'GRBG',group:2,originX:1,originY:3},bytes=Buffer.alloc(7+22*6,0xee);
    for(let y=0;y<6;y++)for(let x=0;x<8;x++){const value=y*100+x;bytes.writeUInt16LE(alignment==='msb'?value<<(16-bitDepth):value|(0xffff^(2**bitDepth-1)),7+y*22+x*2);}
    fixture(bytes,spec,(file,image)=>{
      const grid=imagePixels(file,image,{x:3,y:2,width:3,height:2});
      assert.deepEqual(grid.values,[203,204,205,303,304,305]);assert.equal(grid.channels,1);assert.equal(grid.sampleType,'raw');
      assert.deepEqual(grid.cfa,{pattern:'GRBG',group:2,originX:1,originY:3});
      assert.throws(()=>imagePixels(file,image,{x:7,y:0,width:2,height:1}),/outside/);
      assert.throws(()=>imagePixels(file,image,{x:.5,y:0,width:2,height:1}),/integer/);
    });
  }
});

test('Bounded pixel requests read only requested scanlines from a large RAW file',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isp-pixel-stream-')),file=path.join(dir,'large.raw');
  fs.closeSync(fs.openSync(file,'w'));fs.truncateSync(file,8192*8192*2);
  const original=fs.readSync;let readBytes=0;
  try{
    fs.readSync=(...args)=>{readBytes+=args[3];return original(...args);};
    const image={id:'large',spec:{format:'raw',width:8192,height:8192,bitDepth:12,alignment:'lsb',pattern:'RGGB',group:1,originX:0,originY:0,offset:0,stride:16384}};
    assert.deepEqual(imagePixels(file,image,{x:8000,y:8000,width:3,height:2}).values,[0,0,0,0,0,0]);assert.equal(readBytes,12);
    assert.throws(()=>imagePixels(file,image,{x:0,y:0,width:65,height:64}),/4,096/);
    assert.throws(()=>imageStatistics(file,image,{x:0,y:0,width:8192,height:8192}),new RegExp(MAX_STAT_SAMPLES.toLocaleString('en-US')));
  }finally{fs.readSync=original;fs.rmSync(dir,{recursive:true,force:true});}
});

test('Bayer, Tetra and TetraSquare statistics preserve CFA origin and separate green planes for WB',()=>{
  for(const group of [1,2,4])for(const pattern of ['RGGB','GRBG','GBRG','BGGR']){
    const spec={format:'raw',width:24,height:24,bitDepth:12,pattern,group,originX:1,originY:3},bytes=Buffer.alloc(24*24*2),values={R:200,Gr:400,Gb:400,B:100};
    for(let y=0;y<24;y++)for(let x=0;x<24;x++){
      const row=Math.floor((y+3)/group)%2,column=Math.floor((x+1)/group)%2,letter=pattern[row*2+column];
      const channel=letter==='G'?(pattern.slice(row*2,row*2+2).includes('R')?'Gr':'Gb'):letter;
      assert.equal(cfaChannel(spec,x,y),channel);bytes.writeUInt16LE(values[channel],(y*24+x)*2);
    }
    fixture(bytes,spec,(file,image)=>{
      const result=imageStatistics(file,image,{x:0,y:0,width:24,height:24});
      for(const [name,c]of Object.entries(result.channels)){assert.equal(c.mean,values[name]);assert.equal(c.std,0);assert.equal(c.count,144);}
      assert.deepEqual(result.whiteBalance.gains,{R:2,G:1,B:4});assert.equal(result.levels.blackSpecified,false);
    });
  }
});

test('WB excludes black/saturated samples and merged ROI summaries equal pooled statistics',()=>{
  const spec={format:'raw',width:4,height:4,bitDepth:10,pattern:'RGGB',group:1},bytes=Buffer.alloc(32),samples=[100,200,0,200,200,50,200,50,100,200,1023,200,200,50,200,50];
  samples.forEach((v,i)=>bytes.writeUInt16LE(v,i*2));
  fixture(bytes,spec,(file,image)=>{
    const result=imageStatistics(file,image,{x:0,y:0,width:4,height:4},{black:10});
    assert.equal(result.channels.R.count,4);assert.equal(result.channels.R.blackCount,1);assert.equal(result.channels.R.saturationCount,1);assert.equal(result.channels.R.validMean,100);assert.equal(result.channels.R.validCount,2);
    assert.equal(result.whiteBalance.gains.R,190/90);assert.equal(result.whiteBalance.gains.B,190/40);
    const halves=[0,2].map(y=>imageStatistics(file,image,{x:0,y,width:4,height:2},{black:10}));
    const aggregate=combineStatistics(halves);
    for(const channel of ['R','Gr','Gb','B'])for(const key of ['count','mean','std','blackCount','saturationCount','validCount','validMean'])assert.ok(Math.abs(aggregate.channels[channel][key]-result.channels[channel][key])<1e-10,`${channel}.${key}`);
    assert.deepEqual(aggregate.whiteBalance,result.whiteBalance);
    assert.equal(imageStatistics(file,image,{x:0,y:0,width:1,height:1}).whiteBalance.available,false);
    assert.throws(()=>imageStatistics(file,image,{x:0,y:0,width:1,height:1},{black:1023,white:1023}),/black/);
  });
});

test('BMP bottom-up and palette pixels and RGBA8 return stored RGB values',()=>{
  const bmp=Buffer.alloc(70);bmp.write('BM');bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(2,18);bmp.writeInt32LE(2,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.set([255,0,0,255,255,255],54);bmp.set([0,0,255,0,255,0],62);
  fixture(bmp,{format:'bmp'},(file,image)=>{assert.deepEqual(imagePixels(file,image,{x:0,y:0,width:2,height:2}).values,[255,0,0,0,255,0,0,0,255,255,255,255]);assert.equal(imageStatistics(file,image,{x:0,y:0,width:2,height:2}).whiteBalance.available,false);});
  const palette=Buffer.alloc(54+8+4);palette.write('BM');palette.writeUInt32LE(62,10);palette.writeUInt32LE(40,14);palette.writeInt32LE(2,18);palette.writeInt32LE(-1,22);palette.writeUInt16LE(1,26);palette.writeUInt16LE(8,28);palette.writeUInt32LE(2,46);palette.set([30,20,10,0,60,50,40,0,1,0],54);
  fixture(palette,{format:'bmp'},(file,image)=>assert.deepEqual(imagePixels(file,image,{x:0,y:0,width:2,height:1}).values,[40,50,60,10,20,30]));
  fixture(Buffer.from([9,10,11,255,20,30,40,255]),{format:'rgba8',width:2,height:1},(file,image)=>{const grid=imagePixels(file,image,{x:1,y:0,width:1,height:1});assert.deepEqual(grid.values,[20,30,40]);assert.equal(grid.channels,3);});
});

test('Saved RGB crop PNGs support numerical analysis without the original image',()=>{
  const bytes=encodePng(2,2,Buffer.from([10,20,30,255,20,30,40,255,30,40,50,255,40,50,60,255]));
  fixture(bytes,{format:'png',width:2,height:2,bitDepth:8},(file,image)=>{
    const stats=imageStatistics(file,image,{x:0,y:0,width:2,height:2});assert.equal(stats.channels.R.mean,25);assert.equal(stats.channels.G.mean,35);assert.equal(stats.channels.B.mean,45);
    assert.equal(stats.whiteBalance.available,false);assert.equal(stats.sampleType,'rgb');
  });
});
