'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { AdtsParser, UsbMedia } = require('../cam-live-iphone');
const FFMPEG = '/Applications/Nova AI Mac.app/Contents/Resources/bin/ffmpeg';
function jpeg(width = 64, height = 32) {
  const result = spawnSync(FFMPEG, ['-v','error','-f','lavfi','-i',`color=c=red:size=${width}x${height}`,'-frames:v','1','-f','image2pipe','-c:v','mjpeg','pipe:1'], {maxBuffer:4*1024*1024});
  assert.equal(result.status, 0, result.stderr.toString()); return result.stdout;
}
function adts(payload) {
  const length=payload.length+7;
  return Buffer.concat([Buffer.from([0xff,0xf1,0x50,0x40|(length>>11),(length>>3)&255,((length&7)<<5)|31,0xfc]),payload]);
}
function get(port, route, method='GET') {
  return new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port,path:route,method},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});request.on('error',reject);request.end();});
}
test('ADTS fragmentation preserves raw AAC units and rejects incompatible format',()=>{
  const frames=[Buffer.from([1,2,3]),Buffer.from([4,5]),Buffer.from([6])];const stream=Buffer.concat(frames.map(adts));const parser=new AdtsParser();const output=[];
  for(const byte of stream)output.push(...parser.push(Buffer.from([byte])));
  assert.deepEqual(output,frames);assert.equal(parser.pending.length,0);
  for(const modify of [b=>b[2]=0x4c,b=>b[3]=0x80,b=>b[2]=0x10,b=>b[0]=0]){const bad=adts(Buffer.from([1]));modify(bad);assert.throws(()=>new AdtsParser().push(bad));}
});
test('PCM resampling creates decodable AAC-LC mono 44100 using bundled FFmpeg',()=>{
  const pcm=Buffer.alloc(48000*2);for(let i=0;i<48000;i++)pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*12000),i*2);
  const encoded=spawnSync(FFMPEG,['-nostdin','-v','error','-f','s16le','-ar','48000','-ac','1','-i','pipe:0','-c:a','aac','-profile:a','aac_low','-ar','44100','-ac','1','-b:a','96k','-f','adts','pipe:1'],{input:pcm,maxBuffer:1024*1024});
  assert.equal(encoded.status,0,encoded.stderr.toString());const parser=new AdtsParser();let count=0;
  for(let i=0;i<encoded.stdout.length;i+=17)count+=parser.push(encoded.stdout.subarray(i,i+17)).length;
  assert(count>=43);assert.equal(parser.pending.length,0);
  const decoded=spawnSync(FFMPEG,['-nostdin','-v','error','-f','aac','-i','pipe:0','-f','s16le','-ac','1','-ar','44100','pipe:1'],{input:encoded.stdout,maxBuffer:1024*1024});
  assert.equal(decoded.status,0,decoded.stderr.toString());assert(decoded.stdout.length>=44100*2);
});
test('loopback HTTP enforces freshness, JPEG bounds, audio sequence/ring and closes sockets',async()=>{
  let clock=100;const media=new UsbMedia({now:()=>clock});const port=await media.listen();
  try{
    const framePath=media.framePath,audioPath=media.audioPath;
    assert.equal(media.server.address().address,'127.0.0.1');assert.equal((await get(port,framePath)).status,503);
    assert.equal((await get(port,'/frame.jpg')).status,404);assert.equal((await get(port,`/s/${'0'.repeat(32)}/frame.jpg`)).status,404);
    assert.equal(media.frame(Buffer.from([0xff,0xd8,0xff,0xd9])).ok,false);
    assert.equal(media.frame(Buffer.alloc(2*1024*1024+1)).ok,false);
    const frame=jpeg();assert.equal(media.frame(frame).ok,true);const served=await get(port,framePath);assert.equal(served.status,200);assert.deepEqual(served.body,frame);assert.equal(served.headers['cache-control'],'no-store');
    assert.equal((await get(port,`${audioPath}?after=0`)).status,503);
    for(let i=1;i<=120;i++)assert.equal(media.audioPacket(Buffer.from([i])).ok,true);
    assert.equal(media.audio.length,96);assert.equal(media.sequence,120n);
    const response=await get(port,`${audioPath}?after=0`);assert.equal(response.status,200);assert.equal(response.body.toString('ascii',0,4),'OBA1');
    const seq=[];for(let i=4;i<response.body.length;){seq.push(response.body.readBigUInt64BE(i));const size=response.body.readUInt16BE(i+8);assert.equal(size,1);i+=10+size;}
    assert.equal(seq.length,32);assert.equal(seq[0],89n);assert.equal(seq.at(-1),120n);
    assert.deepEqual((await get(port,`${audioPath}?after=120`)).body,Buffer.from('OBA1'));
    assert.equal((await get(port,`${audioPath}?after=-1`)).status,400);assert.equal((await get(port,`${audioPath}?after=18446744073709551616`)).status,400);
    assert.equal((await get(port,framePath,'POST')).status,405);assert.equal((await get(port,'/unknown')).status,404);
    clock+=1001;assert.equal((await get(port,framePath)).status,503);assert.equal((await get(port,audioPath)).status,503);
  }finally{await media.close();}
  assert.equal(media.server,null);await assert.rejects(()=>get(port,media.framePath));
});
module.exports={jpeg,adts};
