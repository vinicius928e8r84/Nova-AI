'use strict';
// Preparação do iPhone por USB: valida a senha SSH do jailbreak, instala a
// chave de acesso neste Mac e a ponte de câmera (quando o modelo é compatível).
// A interface dessa conversa é o modal dentro do Nova (services/iphone-setup/inapp.js).
const {Client}=require('./node_modules/ssh2');
const fs=require('fs'),path=require('path'),os=require('os'),net=require('net');
const {execFile,spawn}=require('child_process');
let busy=false,proxy;
const quote=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
const run=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{timeout:15000},(e,out)=>e?reject(e):resolve(String(out).trim())));
const portOpen=()=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:2222});s.setTimeout(1000);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false)});});

// Garante o túnel USB (127.0.0.1:2222) antes de autenticar. Sem isto, o ssh2
// recebia "Connection lost before handshake" quando o iproxy ainda não tinha subido.
async function ensureTunnel(){
 const open=()=>new Promise(res=>{const s=net.connect({host:'127.0.0.1',port:2222,timeout:800});const done=v=>{try{s.destroy();}catch(_){}res(v);};s.once('connect',()=>done(true));s.once('error',()=>done(false));s.once('timeout',()=>done(false));});
 if(await open())return true;
 try{const child=spawn(require('../ios-tools').tool('iproxy'),['2222','22'],{stdio:'ignore',detached:true});child.unref();}catch(_){}
 for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,700));if(await open())return true;}
 return false;
}
function command(client,cmd,input){return new Promise((resolve,reject)=>client.exec(cmd,(error,stream)=>{if(error)return reject(error);let stdout='',stderr='';const timer=setTimeout(()=>{stream.close();reject(new Error('O iPhone demorou demais para responder.'));},90000);stream.on('data',data=>stdout+=data);stream.stderr.on('data',data=>stderr+=data);stream.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(stderr.includes('password')?'Senha administrativa recusada pelo iPhone.':stderr.trim()||'Comando não concluído no iPhone.'));});stream.end(input||'');}));}
// Versão do helper nova-locale = linha HELPER_VERSION=<n> do nova-locale.sh que vai para o
// aparelho (o número fica só no script; o Conectar lê dele). Sem a linha: null.
function localeHelperVersion(file){try{const m=/^HELPER_VERSION=(\d+)[ \t]*$/m.exec(fs.readFileSync(file,'utf8'));return m?m[1]:null;}catch(_){return null;}}
// Depois de reiniciar o serviço, o helper novo grava {"ok":true,"message":"pronto v<versão>"} no
// status. Espera até ~10 s por essa versão (leitura simples, sem sudo). Sem a versão, o processo
// antigo ainda roda o texto velho do script. Script sem versão: não há o que conferir (aceita).
async function waitLocaleHandshake(client,version,opts){
 if(!version)return true;
 const tries=(opts&&opts.tries)||20,delay=(opts&&opts.delayMs)||500,want=new RegExp('"message":"pronto v'+version+'"');
 for(let i=0;i<tries;i++){
  let out='';try{out=await command(client,'cat /var/tmp/nova-locale-status.json 2>/dev/null || true');}catch(_){}
  if(want.test(out))return true;
  if(i<tries-1)await new Promise(r=>setTimeout(r,delay));
 }
 return false;
}
async function prepare(id,password,service){
 if(busy)throw new Error('Já existe uma preparação em andamento.');
 if(typeof password!=='string'||!password||password.length>1024||/[\r\n\0]/.test(password))throw new Error('Informe uma senha SSH válida.');
 busy=true;let client;
 try{
 const udid=id.slice(4);if(!/^[a-fA-F0-9-]{20,64}$/.test(udid))throw new Error('Identificador do iPhone inválido.');
 const ids=(await run(require('../ios-tools').tool('idevice_id'),['-l'])).split('\n').filter(Boolean);
 if(ids.length!==1||ids[0]!==udid)throw new Error('Conecte somente o iPhone selecionado por USB.');
 if(!(await ensureTunnel())) throw new Error('O túnel USB não abriu (porta 2222). Reconecte o iPhone, confira se o jailbreak está ativo e tente de novo.');
 const pinsFile=path.join(service.baseDir,'iphone-hosts.json');const pins=fs.existsSync(pinsFile)?JSON.parse(fs.readFileSync(pinsFile,'utf8')):{};let fingerprint;
 client=new Client();
 await new Promise((resolve,reject)=>{
  let settled=false;
  const done=(fn,arg)=>{if(settled)return;settled=true;fn(arg);};
  // `on` (não `once`): o ssh2 emite mais de um erro (handshake, socket) e um erro
  // sem listener derrubava o processo principal do Nova com a caixa de diálogo.
  client.on('error',()=>done(reject,new Error('Não foi possível autenticar. Confira a senha SSH, o jailbreak ativo e o OpenSSH no Sileo.')));
  client.on('close',()=>done(reject,new Error('A conexão SSH caiu antes de terminar. Reconecte o iPhone em PHONE CONTROL e tente de novo.')));
  client.on('ready',()=>done(resolve));
  client.connect({host:'127.0.0.1',port:2222,username:'mobile',password,readyTimeout:15000,algorithms:{serverHostKey:['ssh-ed25519']},hostHash:'sha256',hostVerifier:hash=>{fingerprint=hash;return !pins[udid]||pins[udid]===hash;}});});
 await command(client,'test -d /var/jb && command -v sudo >/dev/null');
 pins[udid]=fingerprint;fs.writeFileSync(pinsFile,JSON.stringify(pins,null,2),{mode:0o600});
 let sshPaths;try{sshPaths=require('../iphone-ssh').paths();}catch(_){const d=path.join(os.homedir(),'.ssh');sshPaths={dir:d,key:path.join(d,'id_iphone'),knownHosts:path.join(d,'known_hosts')};}fs.mkdirSync(sshPaths.dir,{recursive:true,mode:0o700});const key=sshPaths.key;
 if(!fs.existsSync(key))await run('/usr/bin/ssh-keygen',['-t','ed25519','-N','','-f',key,'-C','Nova AI USB']);
 if(!fs.existsSync(key+'.pub'))throw new Error('A chave SSH existente não possui arquivo público. Nenhuma chave foi substituída.');
 const pub=fs.readFileSync(key+'.pub','utf8').trim();
 if(!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(pub))throw new Error('Formato de chave pública não suportado.');
 await command(client,'umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '+quote(pub)+' ~/.ssh/authorized_keys || printf "%s\\n" '+quote(pub)+' >> ~/.ssh/authorized_keys');
 // Pin the exact server key for existing OpenSSH consumers without replacing existing entries.
 const serverKey=await command(client,"cat /var/jb/etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || cat /etc/ssh/ssh_host_ed25519_key.pub");
 const fields=serverKey.trim().split(/\s+/);if(fields[0]!=='ssh-ed25519'||!fields[1])throw new Error('Não foi possível verificar a chave pública SSH do aparelho.');
 const crypto=require('crypto');if(crypto.createHash('sha256').update(Buffer.from(fields[1],'base64')).digest('hex')!==fingerprint)throw new Error('A chave pública não corresponde ao servidor USB autenticado.');
 const known=sshPaths.knownHosts,line='[127.0.0.1]:2222 '+fields.slice(0,2).join(' ');
 const prior=fs.existsSync(known)?fs.readFileSync(known,'utf8'):'';
 if(!prior.includes(line))fs.appendFileSync(known,(prior&&!prior.endsWith('\n')?'\n':'')+line+'\n',{mode:0o600});
 const check=await service.iosSsh('test -d /var/jb');if(!check.ok)throw new Error('Senha aceita, mas a chave de acesso não foi validada. Verifique conflitos de chave SSH neste Mac.');
 const model=await run(require('../ios-tools').tool('ideviceinfo'),['-u',udid,'-k','ProductType']);
 const version=await run(require('../ios-tools').tool('ideviceinfo'),['-u',udid,'-k','ProductVersion']);
 let camera='Ponte de câmera não instalada: este modelo/iOS ainda não foi validado.';
 const TARGET='0.1-39';
 if(model==='iPhone10,2'&&version==='16.7.16'){
  const current=(await command(client,"/var/jb/usr/bin/dpkg-query -W -f='${Version}' com.aquiles.obsgraph-bridge 2>/dev/null || true")).trim();
  const upToDate=current&&(await command(client,'/var/jb/usr/bin/dpkg --compare-versions '+quote(current)+' ge '+quote(TARGET)+' && echo yes || echo no')).trim()==='yes';
  if(upToDate)camera='Ponte de câmera '+current+' já instalada e atualizada.';
  else{
   const packagePath=path.join(__dirname,'camera.deb');
   if(!fs.existsSync(packagePath))throw new Error('Pacote de câmera ausente no Nova. A conexão SSH já foi preparada.');
   await new Promise((resolve,reject)=>client.sftp((error,sftp)=>error?reject(error):sftp.fastPut(packagePath,'/var/mobile/NovaAI-OBSGraphBridge.deb',e=>{sftp.end();e?reject(e):resolve();})));
   await command(client,"sudo -S -p '' /var/jb/usr/bin/dpkg -i /var/mobile/NovaAI-OBSGraphBridge.deb",password+'\n');
   camera='Ponte de câmera '+TARGET+' instalada.';
  }
  // O dylib novo só entra em memória quando o mediaserverd reinicia; sem isso a
  // ponte continua reportando a versão antiga e a câmera fica "não pronta".
  try {
   await command(client,"sudo -S -p '' /var/jb/bin/launchctl kickstart -k system/com.apple.mediaserverd",password+'\n');
   camera+=' Serviço de mídia reiniciado — a ponte já está carregada.';
  } catch (e) {
   camera+=' Não consegui reiniciar o mediaserverd: '+String(e&&e.message||e).slice(0,120);
  }
 }
 // Spoofing de modelo (novamodel): instala o .deb quando o pacote já estiver junto do
 // app. Enquanto o Jailbreak Specialist não entrega o novamodel.deb, o Conectar segue
 // normalmente (este passo é simplesmente ignorado).
 const modelDebPath=path.join(__dirname,'novamodel.deb');
 if(fs.existsSync(modelDebPath)){
  const nmCurrent=(await command(client,"/var/jb/usr/bin/dpkg-query -W -f='${Version}' com.aquiles.novamodel 2>/dev/null || true")).trim();
  if(nmCurrent)camera+=' Spoofing de modelo (novamodel '+nmCurrent+') já instalado.';
  else{
   await new Promise((resolve,reject)=>client.sftp((error,sftp)=>error?reject(error):sftp.fastPut(modelDebPath,'/var/mobile/NovaAI-Novamodel.deb',e=>{sftp.end();e?reject(e):resolve();})));
   await command(client,"sudo -S -p '' /var/jb/usr/bin/dpkg -i /var/mobile/NovaAI-Novamodel.deb",password+'\n');
   camera+=' Spoofing de modelo (novamodel) instalado.';
  }
 }
 // GPS/fuso (nova-locale): helper root instalado/atualizado a cada Conectar, com a senha.
 try{
  const locSh=path.join(__dirname,'nova-locale.sh'),locPl=path.join(__dirname,'com.aquiles.novalocale.plist');
  if(!fs.existsSync(locSh)||!fs.existsSync(locPl))camera+=' Helper nova-locale ausente no Nova.';
  else{
   await new Promise((resolve,reject)=>client.sftp((error,sftp)=>error?reject(error):sftp.fastPut(locSh,'/var/mobile/nova-locale.sh',e=>{sftp.end();e?reject(e):resolve();})));
   await new Promise((resolve,reject)=>client.sftp((error,sftp)=>error?reject(error):sftp.fastPut(locPl,'/var/mobile/com.aquiles.novalocale.plist',e=>{sftp.end();e?reject(e):resolve();})));
   await command(client,"sudo -S -p '' mkdir -p /var/jb/usr/libexec /var/jb/Library/LaunchDaemons",password+'\n');
   await command(client,"sudo -S -p '' mv /var/mobile/nova-locale.sh /var/jb/usr/libexec/nova-locale.sh && sudo -S -p '' chmod 755 /var/jb/usr/libexec/nova-locale.sh",password+'\n'+password+'\n');
   await command(client,"sudo -S -p '' mv /var/mobile/com.aquiles.novalocale.plist /var/jb/Library/LaunchDaemons/ && sudo -S -p '' chown root:wheel /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist",password+'\n'+password+'\n');
   await command(client,"sudo -S -p '' /var/jb/bin/launchctl bootstrap system /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist 2>/dev/null || sudo -S -p '' /var/jb/bin/launchctl kickstart -k system/com.aquiles.novalocale 2>/dev/null || true",password+'\n'+password+'\n');
   // Confere o reinício antes de dizer "atualizado": os erros acima são engolidos (|| true).
   const locVer=localeHelperVersion(locSh);
   camera+=(await waitLocaleHandshake(client,locVer))?' Fuso/idioma (nova-locale'+(locVer?' v'+locVer:'')+') atualizado.':' nova-locale: arquivos enviados, mas o serviço não confirmou a versão v'+locVer+'. Rode o Conectar de novo.';
  }
 }catch(e){camera+=' nova-locale não atualizado: '+String(e&&e.message||e).slice(0,120);}
 // Proxy do iPhone (novaproxy): instalado uma vez, com a senha do Conectar.
 try{
  const nxCurrent=(await command(client,"/var/jb/usr/bin/dpkg-query -W -f='${Version}' com.aquiles.novaproxy 2>/dev/null || true")).trim();
  if(nxCurrent)camera+=' Proxy do iPhone (novaproxy '+nxCurrent+') já instalado.';
  else{
   const nxDeb=path.join(__dirname,'novaproxy.deb');
   if(!fs.existsSync(nxDeb))camera+=' Pacote novaproxy ausente no Nova.';
   else{
    await new Promise((resolve,reject)=>client.sftp((error,sftp)=>error?reject(error):sftp.fastPut(nxDeb,'/var/mobile/novaproxy.deb',e=>{sftp.end();e?reject(e):resolve();})));
    await command(client,"sudo -S -p '' /var/jb/usr/bin/dpkg -i /var/mobile/novaproxy.deb",password+'\n');
    camera+=' Proxy do iPhone (novaproxy) instalado.';
   }
  }
 }catch(e){camera+=' novaproxy não instalado: '+String(e&&e.message||e).slice(0,120);}
 const vnc=await command(client,'/var/jb/usr/bin/dpkg-query -W 2>/dev/null || true');
 return {success:true,message:'Conectado por USB. Acesso SSH configurado; a senha não foi salva.\n\n'+camera+'\n\n'+(/catvnc/i.test(vnc)?'CatVNC encontrado. A tela ao vivo usa a senha configurada em Ajustes → CatVNC.':'Para tela e controle por toque, instale e configure o CatVNC pelo Sileo. O Nova não inclui esse pacote.')+'\n\nAs funções disponíveis dependem do suporte a iOS de cada aba.'};
 }finally{password='';if(client)client.end();busy=false;}
}
// Abre o modal de senha dentro da janela principal (nada de janela externa).
function prompt(win,payload){
 if(!win||win.isDestroyed())return {success:false,error:'A janela do Nova não está disponível.'};
 const data={id:String(payload&&payload.id||''),name:String(payload&&payload.name||'')};
 if(!data.id)return {success:false,error:'Selecione um iPhone conectado.'};
 win.webContents.send('nova:iphone-setup-open',data);
 return {success:true,message:'Informe a senha SSH no quadro do Nova.'};
}
module.exports={prepare,prompt,__test:{localeHelperVersion,waitLocaleHandshake}};
