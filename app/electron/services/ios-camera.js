'use strict';
// Bridge da câmera nativa do iPhone (jailbreak OBSGraphBridge).
//
// Dois papéis separados neste arquivo:
//  1. TRANSMISSÃO (fluxo antigo, intacto): start(videoPath)/stop() sobem o
//     servidor MJPEG + túnel e alimentam a câmera com o vídeo do Mac.
//  2. SEQUESTRO (item 3 da aba): startCamSpoof()/stopCamSpoof() apenas trocam
//     a fonte da câmera (injetada <-> real) e NUNCA derrubam uma transmissão
//     em andamento — nem o servidor/túnel local, nem o CAM LIVE.
//
// Transporte camuflado (bridge 0.1-39): caminho com token de 32 hex, socket
// Unix no iPhone quando possível e porta TCP aleatória como reserva. A rota
// antiga /frame.jpg e a porta 18999 não são mais usadas.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const {spawn, execFile} = require('child_process');
const iphoneSsh = require('./iphone-ssh');
const CONTROL = '/var/tmp/obs-graph-bridge-control.json';
const SSH = ['-p','2222', ...iphoneSsh.sshOptions(),'-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes'];
const quote = s => "'" + String(s).replace(/'/g,"'\\''") + "'";
function bridgePatch(state) {
 const match = /^0\.1-(\d+)/.exec(String((state && state.version) || ''));
 return match ? Number(match[1]) : 0;
}
class IosCamera {
 constructor(service) {
  this.service=service; this.frame=null; this.frameAt=0; this.clients=new Set();
  this.token=crypto.randomBytes(16).toString('hex');
  this.framePath=`/s/${this.token}/frame.jpg`;
  this.transport=null; this.socketPath=null; this.url=null;
 }
 run(file,args,timeout=15000) { return new Promise((resolve,reject)=>execFile(file,args,{timeout,maxBuffer:1024*1024,windowsHide:true},(err,out,stderr)=>err?reject(new Error(String(stderr||err.message).trim())):resolve(String(out)))); }
 ssh(cmd) { return this.run(require('./tool-paths').sshExigido(),[...SSH,'mobile@127.0.0.1',cmd]); }
 async status() {
  try {
   const state=JSON.parse(await this.ssh('cat /var/tmp/obs-graph-bridge-status.json'));
   const ready=bridgePatch(state)>=39 && !!state.hooksReady && !state.faulted;
   return {platform:'ios',installed:ready,active:!!state.enabled,ready,bridgeVersion:state.version,
    message:ready?`Bridge do jailbreak pronto (${state.version}). Toque em Ligar para ativar a câmera.`:'Bridge não está pronto; atualize por USB (Conectar em PHONE CONTROL).',state};
  } catch(e) {return {platform:'ios',installed:false,active:false,error:'iPhone indisponível por USB/SSH: '+e.message};}
 }
 async install() {
  const state=await this.status();
  if(state.ready) return {platform:'ios',success:true,message:`Bridge do jailbreak pronto (${state.bridgeVersion}).`};
  return {platform:'ios',success:false,error:state.error||'Atualize o bridge por USB em PHONE CONTROL (Conectar) ou pelo instalar-iphone.command.'};
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
   if(req.url===this.framePath) {
    if(!fresh) {res.writeHead(503,{'Cache-Control':'no-store'});res.end('Indisponível');return;}
    res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','Content-Length':this.frame.length});res.end(this.frame);
   } else if(req.url==='/live.mjpg' || req.url==='/stream') {
    // Prévia do próprio app (loopback do Mac); não é o que o iPhone lê.
    res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=nova','Cache-Control':'no-store'});
    this.clients.add(res);req.on('close',()=>this.clients.delete(res));
   } else {res.writeHead(404,{'Cache-Control':'no-store'});res.end('Não encontrado');}
  });
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
  return this.server.address().port;
 }
 _forwardArgs(forward) {
  return [...SSH,'-v','-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-R',forward,'mobile@127.0.0.1'];
 }
 _openForward(args) {
  return new Promise((resolve,reject)=>{
   const child=spawn(require('./tool-paths').sshExigido(),args,{stdio:['ignore','ignore','pipe'],windowsHide:true});
   child.novaAbort=false; this.tunnelProcess=child;
   let stderr='',settled=false;
   const close=()=>{if(this.tunnelProcess===child)this.tunnelProcess=null;try{child.kill();}catch{}}
   const timer=setTimeout(()=>{if(!settled){settled=true;close();reject(new Error('O túnel USB não confirmou o encaminhamento.'));}},8000);
   child.stderr.on('data',b=>{stderr+=b.toString();if(!settled && stderr.includes('remote forward success')){settled=true;clearTimeout(timer);resolve(child);}});
   child.once('error',e=>{clearTimeout(timer);if(!settled){settled=true;close();reject(e);}else this.fail(e.message);});
   child.once('exit',()=>{clearTimeout(timer);if(child.novaAbort)return;if(!settled){settled=true;close();reject(new Error(stderr||'Túnel USB encerrado'));}else this.fail('Túnel USB encerrado');});
  });
 }
 async tunnel(localPort) {
  // 1º: socket Unix no iPhone (nenhuma porta TCP escutando). 2º: porta aleatória.
  const socketPath=`/var/tmp/.nbi-${crypto.randomBytes(4).toString('hex')}.sock`;
  try {
   await this._openForward(this._forwardArgs(`${socketPath}:127.0.0.1:${localPort}`));
   const check=await this.ssh(`chmod 666 ${quote(socketPath)} && test -S ${quote(socketPath)} && echo ok`);
   if(!String(check).includes('ok')) throw new Error('socket recusado');
   this.socketPath=socketPath;
   return {type:'unix',path:socketPath};
  } catch(_) {
   if(this.tunnelProcess){this.tunnelProcess.novaAbort=true;try{this.tunnelProcess.kill();}catch{}this.tunnelProcess=null;}
   try { await this.ssh(`rm -f ${quote(socketPath)}`); } catch {}
   let lastError;
   for(let attempt=0;attempt<3;attempt++) {
    const port=20000+crypto.randomInt(0,20000);
    try {
     await this._openForward(this._forwardArgs(`127.0.0.1:${port}:127.0.0.1:${localPort}`));
     return {type:'tcp',port};
    } catch(error) { lastError=error; }
   }
   throw lastError || new Error('Não foi possível abrir o túnel do iPhone.');
  }
 }
 async start(videoPath) {
  try {
   const status=await this.status();
   if(!status.ready) return {success:false,platform:'ios',error:status.error||'Atualize o bridge (0.1-39) antes de iniciar.'};
   if(!path.isAbsolute(videoPath)||!fs.existsSync(videoPath)) throw new Error('Selecione um arquivo de vídeo existente.');
   await this.stop();
   const localPort=await this.serve();
   this.transport=await this.tunnel(localPort);
   this.url=this.transport.type==='unix'
    ? `http://127.0.0.1${this.framePath}`
    : `http://127.0.0.1:${this.transport.port}${this.framePath}`;
   const ffmpeg=require('./tool-paths').ffmpeg();
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
   await this.enable();
   this.heartbeat=setInterval(()=>this.enable().catch(()=>this.fail()),20000);
   this.heartbeat.unref();
   return {success:true,platform:'ios',port:this.transport.port,reverseOk:true,transport:this.transport.type,message:'Vídeo local ativo na Câmera nativa. Feche e reabra a Câmera.'};
  } catch(e) {await this.stop();return {success:false,platform:'ios',error:e.message};}
 }
 async enable() {
  const state=await this.status();
  if(!state.ready)throw new Error(state.error||'Bridge iOS indisponível');
  const config={mode:'inject',appID:'com.apple.camera',appIDs:['*','com.apple.camera','com.apple.WebKit.GPU','com.apple.mobilesafari','com.apple.facetime'],expiresAt:state.state.timestamp+60,continuous:false,previewOnly:true,directRecording:false,photoPrepareBypass:false,videoInjection:false,frameRate:15,url:this.url};
  if(this.transport && this.transport.type==='unix') config.socket=this.transport.path;
  await this.writeControl(config);
 }
 fail() {if(!this.stopping)this.stop().catch(()=>{});}
 async stop() {
  if(this.stopping)return {success:true,platform:'ios'};
  this.stopping=true;clearInterval(this.heartbeat);this.heartbeat=null;
  if(this.decoder){this.decoder.removeAllListeners('exit');this.decoder.kill();this.decoder=null;}
  if(this.tunnelProcess){this.tunnelProcess.novaAbort=true;this.tunnelProcess.removeAllListeners('exit');this.tunnelProcess.kill();this.tunnelProcess=null;}
  for(const res of this.clients)res.end();this.clients.clear();
  if(this.server){const server=this.server;this.server=null;await new Promise(r=>{server.close(r);server.closeAllConnections?.();});}
  if(this.socketPath){try{await this.ssh(`rm -f ${quote(this.socketPath)}`);}catch{}this.socketPath=null;}
  this.transport=null;this.url=null;
  this.frame=null;this.frameAt=0;
  try{await this.writeControl({mode:'observe'});}catch{}
  this.stopping=false;
  return {success:true,platform:'ios',message:'Injeção desligada. Feche e reabra a Câmera para voltar ao sensor real.'};
 }
 // ── SEQUESTRO (item 3): só troca a fonte da câmera; não mexe na transmissão ──
 transmissaoLocalAtiva() { return !!(this.server && this.tunnelProcess); }
 camLive() {
  const camlive=this.service && this.service.camLiveIphone;
  return (camlive && typeof camlive.running==='boolean') ? camlive : null;
 }
 suspenderHeartbeatLocal() {
  // O renovador da transmissão local reescreveria o controle a cada 20 s;
  // a partir daqui quem decide a fonte da câmera é o sequestro.
  clearInterval(this.heartbeat); this.heartbeat=null;
 }
 async liberarPortaCamera() {
  // Obsoleto: o túnel agora usa socket Unix ou porta aleatória, nunca 18999.
 }
 async startCamSpoof(videoPath) {
  if (videoPath) return this.start(videoPath); // transmissão de vídeo local (fluxo antigo)
  return this.ligarInjecao();
 }
 async ligarInjecao() {
  return this.setCameraInjection(true);
 }
 async stopCamSpoof() {
  return this.setCameraInjection(false);
 }
 async setCameraInjection(enabled) {
  try {
   const camlive=this.camLive();
   if (!camlive) throw new Error('O serviço CAM LIVE está indisponível.');
   const state=await this.status();
   if (!state.ready) throw new Error(state.error || 'A ponte de câmera do iPhone não está pronta.');
   const write=async () => {
    if (!enabled) return this.writeControl({mode:'observe'});
    // Local: o servidor do próprio ios-camera. Caso contrário: o transporte do CAM LIVE.
    const endpoint=this.transmissaoLocalAtiva()
     ? {url:this.url, socket:this.transport && this.transport.type==='unix' ? this.transport.path : null}
     : (typeof camlive.mediaEndpoint==='function' ? camlive.mediaEndpoint() : null);
    if (!endpoint || !endpoint.url) throw new Error('O CAM LIVE ainda não abriu o túnel do iPhone.');
    const config={mode:'inject',appID:'com.apple.camera',appIDs:['*','com.apple.camera','com.apple.WebKit.GPU','com.apple.mobilesafari','com.apple.facetime'],expiresAt:state.state.timestamp+60,continuous:true,previewOnly:false,directRecording:false,photoPrepareBypass:true,videoInjection:true,audioInjection:true,frameRate:30,url:endpoint.url,novaSequestroSession:crypto.randomBytes(8).toString('hex')};
    if (endpoint.socket) config.socket=endpoint.socket;
    return this.writeControl(config);
   };
   if (this.transmissaoLocalAtiva()) {
    this.suspenderHeartbeatLocal();
    await write();
   } else {
    await camlive.setCameraEnabled(enabled, write);
   }
   return {success:true,platform:'ios',message:enabled
    ? 'Injeção ligada. Câmera, FaceTime e Safari (câmera de qualquer app) recebem o CAM LIVE ou ficam pretos enquanto aguardam imagem.'
    : 'Injeção desligada. Se a Câmera estiver aberta, reabra para voltar ao sensor real.'};
  } catch(e) {return {success:false,platform:'ios',error:e.message};}
 }
}
module.exports=IosCamera;
