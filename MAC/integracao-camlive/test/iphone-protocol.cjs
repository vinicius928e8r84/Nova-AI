'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {AdtsParser,UsbMedia}=require('../cam-live-iphone');
const jpeg=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/tiny.jpg'));
function adts(data,{rate=4,channels=1,profile=1}={}) { const n=data.length+7;return Buffer.concat([Buffer.from([255,241,(profile<<6)|(rate<<2)|(channels>>2),((channels&3)<<6)|(n>>11),(n>>3)&255,((n&7)<<5)|31,252]),data]); }
function request(port,url,method='GET') { return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:url,method},res=>{const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>resolve({code:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));});req.on('error',reject);req.end();}); }
test('ADTS fragmentado vira AAC raw, vários pacotes e CRC preservam payload',()=>{
 const parser=new AdtsParser(),packet=adts(Buffer.from([1,2,3]));
 for(let i=0;i<packet.length-1;i++)assert.deepEqual(parser.push(packet.subarray(i,i+1)),[]);
 assert.deepEqual(parser.push(packet.subarray(-1)),[Buffer.from([1,2,3])]);
 assert.equal(parser.push(Buffer.concat([packet,packet])).length,2);
});
test('ADTS rejeita perfil, frequência, canais, sync e comprimento incompatíveis',()=>{
 for(const option of [{rate:3},{channels:2},{profile:0}])assert.throws(()=>new AdtsParser().push(adts(Buffer.from([1]),option)),/AAC-LC/);
 assert.throws(()=>new AdtsParser().push(Buffer.alloc(7)),/ADTS/);
 assert.throws(()=>new AdtsParser().push(Buffer.alloc(1024*1024+1)),/limite/);
});
test('OBA1 usa seq uint64 BE, limita ring96 e entrega últimos32; seq não reinicia',()=>{
 let now=10000;const media=new UsbMedia({now:()=>now});
 for(let i=0;i<120;i++)media.audioPacket(Buffer.from([i]));
 assert.equal(media.audio.length,96);const body=media.batch(0n);assert.equal(body.subarray(0,4).toString(),'OBA1');assert.equal(body.readBigUInt64BE(4),89n);assert.equal(body.readUInt16BE(12),1);
 assert.equal(body.length,4+32*11);assert.equal(media.batch(120n).length,4);
 now+=1001;assert.equal(media.batch(0n),null);
 media.audioPacket(Buffer.from([7]));assert.equal(media.batch(120n).readBigUInt64BE(4),121n);
});
test('token: gerado com 32 hex, aceito sob /s/<token>, e a rota antiga responde 404',()=>{
 const media=new UsbMedia();
 assert.match(media.token,/^[0-9a-f]{32}$/);
 assert.match(media.framePath,/^\/s\/[0-9a-f]{32}\/frame\.jpg$/);
 assert.equal(media.audioPath,`/s/${media.token}/audio`);
 assert.throws(()=>new UsbMedia({token:'ABC'}),/token/i);
 assert.throws(()=>new UsbMedia({token:'0'.repeat(31)}),/token/i);
});
test('HTTP real escuta somente loopback, exige token e fecha conexões',async()=>{
 let now=10000;const media=new UsbMedia({now:()=>now});const port=await media.listen();
 const framePath=media.framePath,audioPath=media.audioPath;
 try{
 assert.equal(media.server.address().address,'127.0.0.1');
 assert.equal((await request(port,framePath)).code,503);
 assert.equal((await request(port,'/frame.jpg')).code,404);
 assert.equal((await request(port,`/s/${'0'.repeat(32)}/frame.jpg`)).code,404);
 assert.equal((await request(port,`${framePath}/../secreto`)).code,404);
 assert.equal((await request(port,`/s/${media.token}`)).code,404);
 assert.equal(media.frame(jpeg).ok,true);let r=await request(port,framePath);assert.equal(r.code,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body,jpeg);
 assert.equal(media.frame(Buffer.alloc(2*1024*1024+1)).ok,false);
 assert.equal(media.frame(Buffer.from([255,216,0,0])).ok,false);
 assert.equal((await request(port,`${audioPath}?after=-1`)).code,400);
 assert.equal((await request(port,`${audioPath}?after=18446744073709551616`)).code,400);
 assert.equal((await request(port,'/audio?after=0')).code,404);
 media.audioPacket(Buffer.from([1,2]));assert.equal((await request(port,`${audioPath}?after=0`)).code,200);
 now+=1001;assert.equal((await request(port,`${audioPath}?after=0`)).code,503);assert.equal((await request(port,framePath)).code,503);
 assert.equal((await request(port,framePath,'POST')).code,405);
 assert.equal((await request(port,'/else')).code,404);
 }finally{await media.close();}
 assert.equal(media.server,null);await assert.rejects(request(port,framePath));
});
module.exports={adts};
