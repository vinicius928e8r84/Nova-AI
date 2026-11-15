'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const {spawn, execFile} = require('child_process');
const PORT = 18999;
const CONTROL = '/var/tmp/obs-graph-bridge-control.json';
const SSH = ['-p','2222','-i',path.join(os.homedir(),'.ssh','id_iphone'),'-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes'];
const quote = s => "'" + String(s).replace(/'/g,"'\\''") + "'";
class IosCamera {
 constructor(service) { this.service=service; this.frame=null; this.frameAt=0; this.clients=new Set(); }
 run(file,args,timeout=15000) { return new Promise((resolve,reject)=>execFile(file,args,{timeout,maxBuffer:1024*1024},(err,out,stderr)=>err?reject(new Error(String(stderr||err.message).trim())):resolve(String(out)))); }
 ssh(cmd) { return this.run('/usr/bin/ssh',[...SSH,'mobile@127.0.0.1',cmd]); }
 async status() {
  try {
   const state=JSON.parse(await this.ssh('cat /var/tmp/obs-graph-bridge-status.json'));
   const ready=state.version==='0.1-30' && state.hooksReady && !state.faulted;
   return {platform:'ios',installed:!!ready,active:!!state.enabled,ready,bridgeVersion:state.version,
    message:ready?'Bridge iPhone USB pronto. Selecione um MP4 para iniciar.':'Atualize o bridge iPhone pelo instalador preparado no Mac.',state};
  } catch(e) {return {platform:'ios',installed:false,active:false,error:'iPhone indisponível por USB/SSH: '+e.message};}
 }
 async install() {
  const state=await this.status();
  if(state.ready) return {platform:'ios',success:true,message:'Bridge iPhone USB instalado e pronto.'};
  return {platform:'ios',success:false,error:state.error || 'A atualização iOS precisa da senha no seu Terminal. Execute MAC/integracao-iphone/instalar-iphone.command. Nenhum APK é usado no iPhone.'};
 }
 async writeControl(config) {
  // Atomic replacement of this bridge's own configuration. Never deletes media or tweaks.
  await this.ssh('umask 077; printf %s '+quote(JSON.stringify(config))+' > '+CONTROL+'.nova-next && mv '+CONTROL+'.nova-next '+CONTROL);
 }
 pushFrame(base64) {
  const frame=Buffer.from(base64,'base64');
  if(frame.length<4 || frame.length>8*1024*1024 || frame[0]!==255 || frame[1]!==216) return;
  this.frame=frame;this.frameAt=Date.now();
  for(const res of this.clients) {
   if(res.destroyed || res.writableEnded) {this.clients.delete(res);continue;}
   if(res.writableLength>1024*1024) continue;
   res.write(Buffer.concat([Buffer.from('--nova\r\nContent-Type: image/jpeg\r\nContent-Length: '+frame.length+'\r\n\r\n'),frame,Buffer.from('\r\n')]));
  }
 }
 async serve() {
  this.server=http.createServer((req,res)=>{
   const fresh=this.frame && Date.now()-this.frameAt<1500;
   if(req.url==='/frame.jpg') {
    if(!fresh) {res.writeHead(503,{'Cache-Control':'no-store'});res.end('Fonte sem quadro recente');return;}
    res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','Content-Length':this.frame.length});res.end(this.frame);
   } else if(req.url==='/live.mjpg' || req.url==='/stream') {
    res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=nova','Cache-Control':'no-store'});
    this.clients.add(res);req.on('close',()=>this.clients.delete(res));
   } else {res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(PORT,'127.0.0.1',resolve);});
 }
 async tunnel() {
  // Reverse SSH exposes only phone loopback; it does not use the Wi-Fi interface.
  await new Promise((resolve,reject)=>{
   this.tunnelProcess=spawn('/usr/bin/ssh',[...SSH,'-v','-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-R',`127.0.0.1:${PORT}:127.0.0.1:${PORT}`,'mobile@127.0.0.1'],{stdio:['ignore','ignore','pipe']});
   let stderr='',settled=false;
   const timer=setTimeout(()=>{if(!settled){settled=true;this.tunnelProcess.kill();reject(new Error('O túnel USB não confirmou o encaminhamento.'));}},8000);
   this.tunnelProcess.stderr.on('data',b=>{stderr+=b.toString();if(!settled && stderr.includes('remote forward success')){settled=true;clearTimeout(timer);resolve();}});
   this.tunnelProcess.once('error',e=>{clearTimeout(timer);if(!settled)reject(e);else this.fail();});
   this.tunnelProcess.once('exit',()=>{clearTimeout(timer);if(!settled)reject(new Error(stderr||'Túnel USB encerrado'));else this.fail();});
  });

 }
 async start(videoPath) {
  try {
   const status=await this.status();
   if(!status.ready) return {success:false,platform:'ios',error:status.error||'Atualize o bridge com instalar-iphone.command antes de iniciar.'};
   if(videoPath && (!path.isAbsolute(videoPath)||!fs.existsSync(videoPath))) throw new Error('Selecione um arquivo de vídeo existente.');
   await this.stop();
   await this.serve();
   await this.tunnel();
   if(videoPath) {
    const ffmpeg=require('./mac-native').tool('ffmpeg');
    if(!ffmpeg) throw new Error('FFmpeg não encontrado no Mac.');
    this.decoder=spawn(ffmpeg,['-nostdin','-loglevel','error','-re','-stream_loop','-1','-i',videoPath,'-an','-vf','fps=15,scale=1280:1280:force_original_aspect_ratio=decrease','-f','image2pipe','-vcodec','mjpeg','-q:v','4','pipe:1'],{stdio:['ignore','pipe','pipe']});
    let pending=Buffer.alloc(0),decoderError='';
    this.decoder.stderr.on('data',chunk=>{decoderError=(decoderError+chunk).slice(-2000);});
    this.decoder.stdout.on('data',chunk=>{
     pending=Buffer.concat([pending,chunk]);
     for(;;) {const end=pending.indexOf(Buffer.from([255,217]));if(end<0)break;const start=pending.indexOf(Buffer.from([255,216]));if(start>=0&&start<end)this.pushFrame(pending.subarray(start,end+2).toString('base64'));pending=pending.subarray(end+2);}
     if(pending.length>8*1024*1024)pending=Buffer.alloc(0);
    });
    this.decoder.once('error',()=>this.fail());
    this.decoder.once('exit',()=>this.fail());
    const deadline=Date.now()+7000;
    while(!this.frame && Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
    if(!this.frame) throw new Error('Não foi possível decodificar o vídeo. '+decoderError);
   }
   await this.enable();
   this.heartbeat=setInterval(()=>this.enable().catch(()=>this.fail()),20000);
   this.heartbeat.unref();
   return {success:true,platform:'ios',port:PORT,reverseOk:true,message:'Bridge USB ativo para a Câmera nativa. Feche e reabra a Câmera. Fotos e gravação ainda precisam de validação no aparelho.'};
  } catch(e) {await this.stop();return {success:false,platform:'ios',error:e.message};}
 }
 async enable() {
  const state=await this.status();
  if(!state.ready)throw new Error(state.error||'Bridge iOS indisponível');
  await this.writeControl({mode:'inject',appID:'com.apple.camera',expiresAt:state.state.timestamp+60,continuous:false,previewOnly:true,directRecording:false,photoPrepareBypass:false,videoInjection:false,frameRate:15,url:`http://127.0.0.1:${PORT}/frame.jpg`});
 }
 fail() {if(!this.stopping)this.stop().catch(()=>{});}
 async stop() {
  if(this.stopping)return {success:true,platform:'ios'};
  this.stopping=true;clearInterval(this.heartbeat);this.heartbeat=null;
  if(this.decoder){this.decoder.removeAllListeners('exit');this.decoder.kill();this.decoder=null;}
  if(this.tunnelProcess){this.tunnelProcess.removeAllListeners('exit');this.tunnelProcess.kill();this.tunnelProcess=null;}
  for(const res of this.clients)res.end();this.clients.clear();
  if(this.server){const server=this.server;this.server=null;await new Promise(r=>{server.close(r);server.closeAllConnections?.();});}
  this.frame=null;this.frameAt=0;
  try{await this.writeControl({mode:'observe'});}catch{}
  this.stopping=false;
  return {success:true,platform:'ios',message:'Bridge desligado. Feche e reabra a Câmera para voltar ao sensor.'};
 }
}
module.exports=IosCamera;
