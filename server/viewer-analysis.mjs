import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import {imageSpec} from './viewer-image.mjs';

export const MAX_PIXEL_SAMPLES = 4096;
export const MAX_STAT_SAMPLES = 16 * 1024 * 1024;
export const COORDINATES = 'zero-based source pixels; x/y inclusive; x+width/y+height exclusive';

export function checkAnalysisArea(spec, area, limit = MAX_STAT_SAMPLES) {
  for (const key of ['x', 'y', 'width', 'height']) if (!Number.isSafeInteger(area[key])) throw new Error('Pixel area requires integer x, y, width and height');
  if (area.x < 0 || area.y < 0 || area.width < 1 || area.height < 1 || area.x + area.width > spec.width || area.y + area.height > spec.height) throw new Error('Pixel area is outside the source image; clip the requested rectangle explicitly');
  if (area.width * area.height > limit) throw new Error(`Pixel area exceeds ${limit.toLocaleString('en-US')} samples; request a smaller ROI`);
  return area;
}

export function cfaChannel(spec, x, y) {
  const column = Math.floor((x + spec.originX) / spec.group) % 2;
  const row = Math.floor((y + spec.originY) / spec.group) % 2;
  const channel = spec.pattern[row * 2 + column];
  return channel !== 'G' ? channel : spec.pattern.slice(row * 2, row * 2 + 2).includes('R') ? 'Gr' : 'Gb';
}

// Read only the requested scanline bytes. Numeric APIs never load a complete RAW frame.
function scanRegion(file, input, area, visit) {
  const spec = imageSpec.parse(input.format === 'png' ? {...input,format:'rgba8'} : input), fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const read = (offset, length) => {
      if (offset < 0 || offset + length > size) throw new Error('Viewer source is truncated');
      const bytes = Buffer.allocUnsafe(length);
      let n = 0;
      while (n < length) { const got = fs.readSync(fd, bytes, n, length - n, offset + n); if (!got) throw new Error('Viewer source is truncated'); n += got; }
      return bytes;
    };
    // Saved RGB crops use our RGBA8 PNG encoder (non-interlaced, filter 0).
    // This fallback lets bundles omit the original full frame while preserving ROI analysis.
    if (input.format === 'png') {
      if (spec.width * spec.height > MAX_STAT_SAMPLES) throw new Error('Saved PNG crop exceeds the analysis sample limit');
      const header = read(0, 33);
      if (header.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || header.toString('ascii',12,16) !== 'IHDR' || header.readUInt32BE(16) !== spec.width || header.readUInt32BE(20) !== spec.height || header[24] !== 8 || header[25] !== 6 || header[26] || header[27] || header[28]) throw new Error('Expected a saved RGBA8 crop PNG');
      const parts=[];let offset=33,total=0;
      while(offset<size){const chunk=read(offset,8),length=chunk.readUInt32BE(0),kind=chunk.toString('ascii',4,8);if(offset+length+12>size)throw new Error('Saved PNG crop is truncated');if(kind==='IDAT'){total+=length;if(total>MAX_STAT_SAMPLES*5)throw new Error('Saved PNG compressed data exceeds its limit');parts.push(read(offset+8,length));}offset+=length+12;if(kind==='IEND')break;}
      const stride=spec.width*4+1, pixels=inflateSync(Buffer.concat(parts),{maxOutputLength:stride*spec.height});
      if(pixels.length!==stride*spec.height)throw new Error('Saved PNG pixel data is truncated');
      for(let y=area.y;y<area.y+area.height;y++){if(pixels[y*stride]!==0)throw new Error('Unsupported saved PNG row filter');for(let x=area.x;x<area.x+area.width;x++){const p=y*stride+1+x*4;visit(x,y,[pixels[p],pixels[p+1],pixels[p+2]]);}}
      return;
    }
    if (spec.format === 'bmp') {
      const header = read(0, 54), dib = header.readUInt32LE(14), width = header.readInt32LE(18), signedHeight = header.readInt32LE(22);
      const bits = header.readUInt16LE(28), offset = header.readUInt32LE(10), stride = Math.ceil(width * bits / 32) * 4;
      if (header.toString('ascii', 0, 2) !== 'BM' || dib < 40 || width !== spec.width || Math.abs(signedHeight) !== spec.height || header.readUInt16LE(26) !== 1 || header.readUInt32LE(30) !== 0 || ![8, 24, 32].includes(bits)) throw new Error('Viewer BMP source metadata has changed');
      if (offset < 14 + dib || offset + stride * spec.height > size) throw new Error('Viewer BMP source is truncated');
      const paletteSize = bits === 8 ? (header.readUInt32LE(46) || 256) : 0;
      if (paletteSize > 256 || (paletteSize && 14 + dib + paletteSize * 4 > offset)) throw new Error('Invalid BMP palette');
      const palette = paletteSize ? read(14 + dib, paletteSize * 4) : null;
      for (let y = area.y; y < area.y + area.height; y++) {
        const bytes = read(offset + (signedHeight > 0 ? spec.height - 1 - y : y) * stride + area.x * (bits / 8), area.width * (bits / 8));
        for (let x = 0; x < area.width; x++) {
          const p = palette ? bytes[x] * 4 : x * (bits / 8), source = palette || bytes;
          if (p + 2 >= source.length) throw new Error('Invalid BMP palette index');
          visit(area.x + x, y, [source[p + 2], source[p + 1], source[p]]);
        }
      }
      return;
    }
    const pixelBytes = spec.format === 'raw' ? 2 : 4, stride = spec.stride || spec.width * pixelBytes;
    if (stride < spec.width * pixelBytes || spec.offset + stride * (spec.height - 1) + spec.width * pixelBytes > size) throw new Error('Viewer source is truncated or has invalid stride');
    for (let y = area.y; y < area.y + area.height; y++) {
      const bytes = read(spec.offset + y * stride + area.x * pixelBytes, area.width * pixelBytes);
      for (let x = 0; x < area.width; x++) {
        if (spec.format === 'raw') { const word = bytes.readUInt16LE(x * 2); visit(area.x + x, y, spec.alignment === 'msb' ? word >>> (16 - spec.bitDepth) : word & (2 ** spec.bitDepth - 1)); }
        else visit(area.x + x, y, [bytes[x * 4], bytes[x * 4 + 1], bytes[x * 4 + 2]]);
      }
    }
  } finally { fs.closeSync(fd); }
}

function base(image, area) {
  return {imageId:image.id, area, spec:image.spec, coordinateSystem:COORDINATES, sampleType:image.spec.format === 'raw' ? 'raw' : 'rgb', valueDomain:image.spec.format === 'raw' ? 'unaltered sensor samples after storage bit alignment; before display rendering' : 'stored RGB8 values; before display rendering'};
}

export function imagePixels(file, image, area) {
  checkAnalysisArea(image.spec, area, MAX_PIXEL_SAMPLES);
  const values = [];
  scanRegion(file, image.spec, area, (_x, _y, value) => Array.isArray(value) ? values.push(...value) : values.push(value));
  const {pattern, group, originX, originY} = image.spec;
  return {...base(image, area), channels:image.spec.format === 'raw' ? 1 : 3, values, ...(image.spec.format === 'raw' ? {cfa:{pattern,group,originX,originY}} : {}), maxSamples:MAX_PIXEL_SAMPLES};
}

function whiteBalance(channels, sampleType, black, white) {
  if (sampleType !== 'raw') return {available:false, reason:'Stored RGB may already be processed. Sensor white balance requires RAW samples.'};
  const greenCount = (channels.Gr?.validCount || 0) + (channels.Gb?.validCount || 0);
  const green = greenCount ? ((channels.Gr?.validMean || 0) * (channels.Gr?.validCount || 0) + (channels.Gb?.validMean || 0) * (channels.Gb?.validCount || 0)) / greenCount - black : 0;
  const red = (channels.R?.validMean ?? black) - black, blue = (channels.B?.validMean ?? black) - black;
  if (!(green > 0 && red > 0 && blue > 0)) return {available:false, reason:'The ROI needs usable R, G and B samples strictly between black and white levels.'};
  return {available:true, reference:'G', gains:{R:green/red,G:1,B:green/blue}, black, white, assumption:'Selected regions must be neutral patches under one illuminant. This is an estimate only; gains are not applied.', excluded:'samples <= black or >= white', greenSamples:greenCount};
}

export function imageStatistics(file, image, area, options = {}) {
  checkAnalysisArea(image.spec, area);
  const black = options.black ?? 0, white = options.white ?? (image.spec.format === 'raw' ? 2 ** image.spec.bitDepth - 1 : 255);
  if (!Number.isFinite(black) || !Number.isFinite(white) || black < 0 || white <= black || white > (image.spec.format === 'raw' ? 2 ** image.spec.bitDepth - 1 : 255)) throw new Error('Statistics require 0 <= black < white <= the source sample maximum');
  const channels = {};
  const add = (channel, value) => {
    const c = channels[channel] ||= {count:0,mean:0,m2:0,min:Infinity,max:-Infinity,blackCount:0,saturationCount:0,validCount:0,validSum:0};
    c.count++; const delta = value - c.mean; c.mean += delta / c.count; c.m2 += delta * (value - c.mean);
    c.min = Math.min(c.min,value); c.max = Math.max(c.max,value);
    if (value <= black) c.blackCount++; else if (value >= white) c.saturationCount++; else {c.validCount++;c.validSum += value;}
  };
  scanRegion(file, image.spec, area, (x,y,value) => { if (Array.isArray(value)) value.forEach((v,i)=>add(['R','G','B'][i],v)); else add(cfaChannel(image.spec,x,y),value); });
  for (const c of Object.values(channels)) {c.std = Math.sqrt(c.m2/c.count);c.validMean = c.validCount ? c.validSum/c.validCount : null;delete c.m2;delete c.validSum;}
  return {...base(image,area),sampleCount:area.width*area.height,levels:{black,white,blackSpecified:options.black !== undefined},channels,whiteBalance:whiteBalance(channels,image.spec.format === 'raw' ? 'raw' : 'rgb',black,white),maxSamples:MAX_STAT_SAMPLES};
}

export function combineStatistics(results) {
  if (!results.length) throw new Error('No crop regions were selected');
  const channels = {};
  for (const result of results) for (const [name, c] of Object.entries(result.channels)) {
    const a = channels[name] ||= {count:0,mean:0,m2:0,min:Infinity,max:-Infinity,blackCount:0,saturationCount:0,validCount:0,validSum:0};
    const count = a.count+c.count, delta = c.mean-a.mean;
    a.m2 += c.std*c.std*c.count + delta*delta*a.count*c.count/count;
    a.mean += delta*c.count/count;a.count=count;a.min=Math.min(a.min,c.min);a.max=Math.max(a.max,c.max);
    a.blackCount+=c.blackCount;a.saturationCount+=c.saturationCount;a.validCount+=c.validCount;a.validSum+=(c.validMean||0)*c.validCount;
  }
  for (const c of Object.values(channels)) {c.std=Math.sqrt(c.m2/c.count);c.validMean=c.validCount?c.validSum/c.validCount:null;delete c.m2;delete c.validSum;}
  const {sampleType,levels} = results[0];
  return {sampleCount:results.reduce((sum,r)=>sum+r.sampleCount,0),sampleType,levels,channels,whiteBalance:whiteBalance(channels,sampleType,levels.black,levels.white),overlapPolicy:'Each selected ROI is counted independently; overlapping pixels are counted once per region.'};
}
