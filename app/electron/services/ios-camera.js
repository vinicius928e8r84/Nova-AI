'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const {spawn, execFile} = require('child_process');
const iphoneSsh = require('./iphone-ssh');
const { quadroValido, entregarQuadro, argumentosDoDecoder, LeitorDoDecoder } = require('./ios-camera-quadros');
const { configuracaoDaPrevia, configuracaoDaInjecao } = require('./ios-camera-injecao');
const CONTROL = '/var/tmp/obs-graph-bridge-control.json';
const SSH = ['-p','2222', ...iphoneSsh.sshOptions(),'-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=accept-new'];
const quote = s => "'" + String(s).replace(/'/g,"'\\''") + "'";
function exigirVideoExistente(videoPath) {
 if(!path.isAbsolute(videoPath)||!fs.existsSync(videoPath)) throw new Error('Selecione um arquivo de vídeo existente.');
}
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
 ssh(cmd) { return this.run(require('./tool-paths').exigirOpenssh('ssh'),[...SSH,'mobile@127.0.0.1',cmd]); }
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
  return {platform:'ios',success:false,error:state.error||'Atualize o bridge por USB em PHONE CONTROL (Conectar).'};
 }
 async writeControl(config) {
  await this.ssh('umask 077; printf %s '+quote(JSON.stringify(config))+' > '+CONTROL+'.nova-next && mv '+CONTROL+'.nova-next '+CONTROL);
 }
 pushFrame(base64) {
  const frame=Buffer.from(base64,'base64');
  if(!quadroValido(frame)) return;
  this.frame=frame;this.frameAt=Date.now();
  entregarQuadro(this.clients,frame);
 }
 async serve() {
  this.server=http.createServer((req,res)=>{
   const fresh=this.frame && Date.now()-this.frameAt<1500;
   if(req.url===this.framePath) {
    if(!fresh) {res.writeHead(503,{'Cache-Control':'no-store'});res.end('Indisponível');return;}
    res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','Content-Length':this.frame.length});res.end(this.frame);
   } else if(req.url==='/live.mjpg' || req.url==='/stream') {
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
   const child=spawn(require('./tool-paths').exigirOpenssh('ssh'),args,{stdio:['ignore','ignore','pipe'],windowsHide:true});
   child.novaAbort=false; this.tunnelProcess=child;
   let stderr='',settled=false;
   const close=()=>{if(this.tunnelProcess===child)this.tunnelProcess=null;try{child.kill();}catch{}}
   const timer=setTimeout(()=>{if(!settled){settled=true;close();reject(new Error('O túnel USB não confirmou o encaminhamento.'));}},8000);
   child.stderr.on('data',b=>{stderr+=b.toString();if(!settled && stderr.includes('remote forward success')){settled=true;clearTimeout(timer);resolve(child);}});
   child.once('error',e=>{clearTimeout(timer);if(!settled){settled=true;close();reject(e);}else this.fail(e.message);});
   child.once('exit',()=>{clearTimeout(timer);if(child.novaAbort)return;if(!settled){settled=true;close();reject(new Error(stderr||'Túnel USB encerrado'));}else this.fail('Túnel USB encerrado');});
  });
 }
 async tunelUnix(socketPath,localPort) {
  await this._openForward(this._forwardArgs(`${socketPath}:127.0.0.1:${localPort}`));
  const check=await this.ssh(`chmod 666 ${quote(socketPath)} && test -S ${quote(socketPath)} && echo ok`);
  if(!String(check).includes('ok')) throw new Error('socket recusado');
  this.socketPath=socketPath;
  return {type:'unix',path:socketPath};
 }
 async descartarTunelUnix(socketPath) {
  if(this.tunnelProcess){this.tunnelProcess.novaAbort=true;try{this.tunnelProcess.kill();}catch{}this.tunnelProcess=null;}
  try { await this.ssh(`rm -f ${quote(socketPath)}`); } catch {}
 }
 async tunelTcp(localPort) {
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
 async tunnel(localPort) {
  const socketPath=`/var/tmp/.nbi-${crypto.randomBytes(4).toString('hex')}.sock`;
  try {
   return await this.tunelUnix(socketPath,localPort);
  } catch(_) {
   await this.descartarTunelUnix(socketPath);
   return this.tunelTcp(localPort);
  }
 }
 async abrirTransmissao() {
  const localPort=await this.serve();
  this.transport=await this.tunnel(localPort);
  this.url=this.transport.type==='unix'
   ? `http://127.0.0.1${this.framePath}`
   : `http://127.0.0.1:${this.transport.port}${this.framePath}`;
 }
 iniciarDecoder(videoPath) {
  const ffmpeg=require('./tool-paths').ffmpeg();
  if(!ffmpeg) throw new Error('FFmpeg não encontrado neste computador.');
  this.decoder=spawn(ffmpeg,argumentosDoDecoder(videoPath),{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const leitor=new LeitorDoDecoder(this.decoder,base64=>this.pushFrame(base64));
  this.decoder.once('error',()=>this.fail());
  this.decoder.once('exit',()=>this.fail());
  return leitor;
 }
 async esperarPrimeiroQuadro(leitor) {
  const deadline=Date.now()+7000;
  while(!this.frame && Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
  if(!this.frame) throw new Error('Não foi possível decodificar o vídeo. '+leitor.erro);
 }
 async start(videoPath) {
  try {
   const status=await this.status();
   if(!status.ready) return {success:false,platform:'ios',error:status.error||'Atualize o bridge (0.1-39) antes de iniciar.'};
   exigirVideoExistente(videoPath);
   await this.stop();
   await this.abrirTransmissao();
   await this.esperarPrimeiroQuadro(this.iniciarDecoder(videoPath));
   await this.enable();
   this.heartbeat=setInterval(()=>this.enable().catch(()=>this.fail()),20000);
   this.heartbeat.unref();
   return {success:true,platform:'ios',port:this.transport.port,reverseOk:true,transport:this.transport.type,message:'Vídeo local ativo na Câmera nativa. Feche e reabra a Câmera.'};
  } catch(e) {await this.stop();return {success:false,platform:'ios',error:e.message};}
 }
 async enable() {
  const state=await this.status();
  if(!state.ready)throw new Error(state.error||'Bridge iOS indisponível');
  const config=configuracaoDaPrevia(state,this.url);
  if(this.transport && this.transport.type==='unix') config.socket=this.transport.path;
  await this.writeControl(config);
 }
 fail() {if(!this.stopping)this.stop().catch(()=>{});}
 encerrarDecoder() {
  if(!this.decoder) return;
  this.decoder.removeAllListeners('exit');this.decoder.kill();this.decoder=null;
 }
 encerrarTunel() {
  if(!this.tunnelProcess) return;
  this.tunnelProcess.novaAbort=true;this.tunnelProcess.removeAllListeners('exit');this.tunnelProcess.kill();this.tunnelProcess=null;
 }
 async fecharServidor() {
  if(!this.server) return;
  const server=this.server;this.server=null;
  await new Promise(r=>{server.close(r);server.closeAllConnections?.();});
 }
 async removerSocket() {
  if(!this.socketPath) return;
  try{await this.ssh(`rm -f ${quote(this.socketPath)}`);}catch{}
  this.socketPath=null;
 }
 async stop() {
  if(this.stopping)return {success:true,platform:'ios'};
  this.stopping=true;
  this.suspenderHeartbeatLocal();
  this.encerrarDecoder();
  this.encerrarTunel();
  for(const res of this.clients)res.end();this.clients.clear();
  await this.fecharServidor();
  await this.removerSocket();
  this.transport=null;this.url=null;
  this.frame=null;this.frameAt=0;
  try{await this.writeControl({mode:'observe'});}catch{}
  this.stopping=false;
  return {success:true,platform:'ios',message:'Injeção desligada. Feche e reabra a Câmera para voltar ao sensor real.'};
 }
 transmissaoLocalAtiva() { return !!(this.server && this.tunnelProcess); }
 camLive() {
  const camlive=this.service && this.service.camLiveIphone;
  return (camlive && typeof camlive.running==='boolean') ? camlive : null;
 }
 suspenderHeartbeatLocal() {
  clearInterval(this.heartbeat); this.heartbeat=null;
 }
 async liberarPortaCamera() {
 }
 async startCamSpoof(videoPath) {
  if (videoPath) return this.start(videoPath);
  return this.ligarInjecao();
 }
 async ligarInjecao() {
  return this.setCameraInjection(true);
 }
 async stopCamSpoof() {
  return this.setCameraInjection(false);
 }
 socketLocal() {
  return this.transport && this.transport.type==='unix' ? this.transport.path : null;
 }
 endpointDaInjecao(camlive) {
  if (this.transmissaoLocalAtiva()) return {url:this.url, socket:this.socketLocal()};
  return typeof camlive.mediaEndpoint==='function' ? camlive.mediaEndpoint() : null;
 }
 async gravarInjecao(camlive,state,enabled) {
  if (!enabled) return this.writeControl({mode:'observe'});
  const endpoint=this.endpointDaInjecao(camlive);
  if (!endpoint || !endpoint.url) throw new Error('O CAM LIVE ainda não abriu o túnel do iPhone.');
  return this.writeControl(configuracaoDaInjecao(state,endpoint));
 }
 async setCameraInjection(enabled) {
  try {
   const camlive=this.camLive();
   if (!camlive) throw new Error('O serviço CAM LIVE está indisponível.');
   const state=await this.status();
   if (!state.ready) throw new Error(state.error || 'A ponte de câmera do iPhone não está pronta.');
   const write=() => this.gravarInjecao(camlive,state,enabled);
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
