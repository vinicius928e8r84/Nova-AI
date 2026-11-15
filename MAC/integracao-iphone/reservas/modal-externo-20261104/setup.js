'use strict';
const {BrowserWindow,ipcMain}=require('electron');
const {Client}=require('./node_modules/ssh2');
const fs=require('fs'),path=require('path'),os=require('os'),net=require('net');
const {execFile,spawn}=require('child_process');
const windows=new Map();let busy=false,registered=false,proxy;
const quote=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
const run=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{timeout:15000},(e,out)=>e?reject(e):resolve(String(out).trim())));
const portOpen=()=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:2222});s.setTimeout(1000);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false)});});
function command(client,cmd,input){return new Promise((resolve,reject)=>client.exec(cmd,(error,stream)=>{if(error)return reject(error);let stdout='',stderr='';const timer=setTimeout(()=>{stream.close();reject(new Error('O iPhone demorou demais para responder.'));},90000);stream.on('data',data=>stdout+=data);stream.stderr.on('data',data=>stderr+=data);stream.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(stderr.includes('password')?'Senha administrativa recusada pelo iPhone.':stderr.trim()||'Comando não concluído no iPhone.'));});stream.end(input||'');}));}
async function prepare(id,password,service){
 if(busy)throw new Error('Já existe uma preparação em andamento.');
 if(typeof password!=='string'||!password||password.length>1024||/[\r\n\0]/.test(password))throw new Error('Informe uma senha SSH válida.');
 busy=true;let client;
 try{
 const udid=id.slice(4);if(!/^[a-fA-F0-9-]{20,64}$/.test(udid))throw new Error('Identificador do iPhone inválido.');
 const ids=(await run(require('../ios-tools').tool('idevice_id'),['-l'])).split('\n').filter(Boolean);
 if(ids.length!==1||ids[0]!==udid)throw new Error('Conecte somente o iPhone selecionado por USB.');
 if(!await portOpen()){
 proxy=spawn(require('../ios-tools').tool('iproxy'),['-u',udid,'2222','22'],{stdio:'ignore'});proxy.on('error',()=>{});
 for(let i=0;i<20&&!await portOpen();i++)await new Promise(r=>setTimeout(r,100));
 }
 const pinsFile=path.join(service.baseDir,'iphone-hosts.json');const pins=fs.existsSync(pinsFile)?JSON.parse(fs.readFileSync(pinsFile,'utf8')):{};let fingerprint;
 client=new Client();
 await new Promise((resolve,reject)=>{client.once('ready',resolve);client.once('error',()=>reject(new Error('Não foi possível autenticar. Confira a senha SSH, o jailbreak ativo e o OpenSSH no Sileo.')));client.connect({host:'127.0.0.1',port:2222,username:'mobile',password,readyTimeout:15000,algorithms:{serverHostKey:['ssh-ed25519']},hostHash:'sha256',hostVerifier:hash=>{fingerprint=hash;return !pins[udid]||pins[udid]===hash;}});});
 await command(client,'test -d /var/jb && command -v sudo >/dev/null');
 pins[udid]=fingerprint;fs.writeFileSync(pinsFile,JSON.stringify(pins,null,2),{mode:0o600});
 const sshDir=path.join(os.homedir(),'.ssh');fs.mkdirSync(sshDir,{recursive:true,mode:0o700});const key=path.join(sshDir,'id_iphone');
 if(!fs.existsSync(key))await run('/usr/bin/ssh-keygen',['-t','ed25519','-N','','-f',key,'-C','Nova AI USB']);
 if(!fs.existsSync(key+'.pub'))throw new Error('A chave SSH existente não possui arquivo público. Nenhuma chave foi substituída.');
 const pub=fs.readFileSync(key+'.pub','utf8').trim();
 if(!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(pub))throw new Error('Formato de chave pública não suportado.');
 await command(client,'umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '+quote(pub)+' ~/.ssh/authorized_keys || printf "%s\\n" '+quote(pub)+' >> ~/.ssh/authorized_keys');
 // Pin the exact server key for existing OpenSSH consumers without replacing existing entries.
 const serverKey=await command(client,"cat /var/jb/etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || cat /etc/ssh/ssh_host_ed25519_key.pub");
 const fields=serverKey.trim().split(/\s+/);if(fields[0]!=='ssh-ed25519'||!fields[1])throw new Error('Não foi possível verificar a chave pública SSH do aparelho.');
 const crypto=require('crypto');if(crypto.createHash('sha256').update(Buffer.from(fields[1],'base64')).digest('hex')!==fingerprint)throw new Error('A chave pública não corresponde ao servidor USB autenticado.');
 const known=path.join(sshDir,'known_hosts'),line='[127.0.0.1]:2222 '+fields.slice(0,2).join(' ');
 const prior=fs.existsSync(known)?fs.readFileSync(known,'utf8'):'';
 if(!prior.includes(line))fs.appendFileSync(known,(prior&&!prior.endsWith('\n')?'\n':'')+line+'\n',{mode:0o600});
 const check=await service.iosSsh('test -d /var/jb');if(!check.ok)throw new Error('Senha aceita, mas a chave de acesso não foi validada. Verifique conflitos de chave SSH neste Mac.');
 const model=await run(require('../ios-tools').tool('ideviceinfo'),['-u',udid,'-k','ProductType']);
 const version=await run(require('../ios-tools').tool('ideviceinfo'),['-u',udid,'-k','ProductVersion']);
 let camera='Ponte de câmera não instalada: este modelo/iOS ainda não foi validado.';
 const TARGET='0.1-38-1+debug';
 if(model==='iPhone10,2'&&version==='16.7.16'){
  const current=(await command(client,"/var/jb/usr/bin/dpkg-query -W -f='${Version}' com.aquiles.obsgraph-bridge 2>/dev/null || true")).trim();
  const upToDate=current&&(await command(client,'/var/jb/usr/bin/dpkg --compare-versions '+quote(current)+' ge '+quote(TARGET)+' && echo yes || echo no')).trim()==='yes';
  if(upToDate)camera='Ponte de câmera '+current+' já instalada e atualizada.';
  else{
   const packagePath=path.join(__dirname,'camera.deb');
   if(!fs.existsSync(packagePath))throw new Error('Pacote de câmera ausente no Nova. A conexão SSH já foi preparada.');
   await new Promise((resolve,reject)=>client.sftp((error,sftp)=>error?reject(error):sftp.fastPut(packagePath,'/var/mobile/NovaAI-OBSGraphBridge.deb',e=>{sftp.end();e?reject(e):resolve();})));
   await command(client,"sudo -S -p '' /var/jb/usr/bin/dpkg -i /var/mobile/NovaAI-OBSGraphBridge.deb",password+'\n');
   camera='Ponte de câmera '+TARGET+' instalada. Pode ser necessário reiniciar o ambiente do jailbreak e reabrir a Câmera.';
  }
 }
 const vnc=await command(client,'/var/jb/usr/bin/dpkg-query -W 2>/dev/null || true');
 return {success:true,message:'Conectado por USB. Acesso SSH configurado; a senha não foi salva.\n\n'+camera+'\n\n'+(/catvnc/i.test(vnc)?'CatVNC encontrado. A tela ao vivo usa a senha configurada em Ajustes → CatVNC.':'Para tela e controle por toque, instale e configure o CatVNC pelo Sileo. O Nova não inclui esse pacote.')+'\n\nAs funções disponíveis dependem do suporte a iOS de cada aba.'};
 }finally{password='';if(client)client.end();busy=false;}
}
function open(id,service){
 if(!registered){registered=true;ipcMain.handle('nova:iphone-console',async event=>{const item=[...windows.values()].find(item=>!item.win.isDestroyed()&&item.win.webContents.id===event.sender.id);if(!item)return {success:false};return item.service.iosStartStream(item.id);});ipcMain.handle('nova:iphone-setup',async(event,password)=>{const item=[...windows.values()].find(item=>!item.win.isDestroyed()&&item.win.webContents.id===event.sender.id);if(!item)return {success:false,error:'Janela de conexão inválida.'};try{return await prepare(item.id,password,item.service);}catch(e){return {success:false,error:e.message};}});}
 const existing=windows.get(id);if(existing&&!existing.win.isDestroyed()){existing.win.focus();return {success:true};}
 const win=new BrowserWindow({width:540,height:660,title:'Conectar iPhone por USB',backgroundColor:'#070f13',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 windows.set(id,{win,id,service});win.on('closed',()=>windows.delete(id));win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.loadFile(path.join(__dirname,'conectar.html'));return {success:true,message:'Informe a senha SSH na janela Conectar iPhone.'};
}
module.exports={open};
