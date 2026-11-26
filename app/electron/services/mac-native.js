'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const {execFile} = require('child_process');
function run(file,args=[],options={}) {
  return new Promise((resolve,reject)=>execFile(file,args,{timeout:15000,...options},(error,stdout)=>error?reject(error):resolve(String(stdout).trim())));
}
function tool(name) {
  const dirs = [process.resourcesPath && path.join(process.resourcesPath,'bin'),path.join(__dirname,'../../resources/bin'),'/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'Library/Android/sdk/platform-tools'),...(process.env.PATH||'').split(':')].filter(Boolean);
  return dirs.map(d=>path.join(d,name)).find(p=>{try{fs.accessSync(p,fs.constants.X_OK);return true;}catch{return false;}})||null;
}
const NOMES_DOS_NAVEGADORES={chrome:['Google Chrome','Google Chrome for Testing'],brave:['Brave Browser'],vivaldi:['Vivaldi'],firefox:['Firefox'],edge:['Microsoft Edge']};
const executavelDoApp = nome=>nome==='Firefox'?'firefox':nome;
function pastasEmbutidas() {
  return [process.resourcesPath&&path.join(process.resourcesPath,'browsers'),path.join(__dirname,'../../browsers')].filter(Boolean);
}
function appsDoNavegador(kind,nome,embutidas) {
  const instalados=['/Applications',path.join(os.homedir(),'Applications')].map(root=>path.join(root,nome+'.app'));
  return [...instalados,...embutidas.map(root=>path.join(root,kind,nome+'.app'))];
}
function executaveisCandidatos(kind,embutidas) {
  const nomes=NOMES_DOS_NAVEGADORES[kind]||NOMES_DOS_NAVEGADORES.chrome;
  return nomes.flatMap(nome=>appsDoNavegador(kind,nome,embutidas).map(app=>path.join(app,'Contents','MacOS',executavelDoApp(nome))));
}
function chromiumDoPlaywright() {
  try {const p=require('playwright').chromium.executablePath();if(fs.existsSync(p))return p;}catch{}
  return null;
}
function chromiumDeReserva(embutidas) {
  const {findBundledChromiumExecutable}=require('./platform-utils');
  return findBundledChromiumExecutable(embutidas)||chromiumDoPlaywright();
}
function browser(kind='chrome') {
  const embutidas=pastasEmbutidas();
  const encontrado=executaveisCandidatos(kind,embutidas).find(p=>fs.existsSync(p));
  if(encontrado)return encontrado;
  return kind==='chrome'?chromiumDeReserva(embutidas):null;
}
function apple(script){return run('/usr/bin/osascript',['-e',script]);}
const quote = s=>JSON.stringify(String(s));
const MODIFICADORES={ctrl:'command down',control:'command down',cmd:'command down',command:'command down',alt:'option down',option:'option down',shift:'shift down',meta:'command down'};
const CODIGOS_DE_TECLA={enter:36,return:36,tab:48,escape:53,backspace:51,delete:117,up:126,down:125,left:123,right:124,home:115,end:119,pageup:116,pagedown:121,f1:122,f2:120,f3:99,f4:118,f5:96,f6:97,f7:98,f8:100,f9:101,f10:109,f11:103,f12:111};
const ATALHOS_DO_WINDOWS=new Map([['alt+f4',{name:'w',mods:['command down']}],['alt+tab',{name:'tab',mods:['command down']}]]);
function teclaNoMac(key) {
  const pieces=String(key).toLowerCase().split('+');const name=pieces.pop();
  const mods=pieces.map(p=>MODIFICADORES[p]);
  if(mods.some(m=>!m))throw new Error('Unknown key modifier');
  return ATALHOS_DO_WINDOWS.get(key.toLowerCase())||{name,mods};
}
function acaoDaTecla(name,key) {
  if(name in CODIGOS_DE_TECLA)return 'key code '+CODIGOS_DE_TECLA[name];
  if(name.length!==1)throw new Error('Unknown key: '+key);
  return 'keystroke '+quote(name);
}
const usandoModificadores = mods=>mods.length?' using {'+mods.join(',')+'}':'';
async function pressKey(key) {
  const {name,mods}=teclaNoMac(key);
  const action=acaoDaTecla(name,key);
  await apple(`tell application "System Events" to ${action}${usandoModificadores(mods)}`);
  return {success:true,key};
}
async function typeText(text,pressEnter=false) {
 const {clipboard}=require('electron');const old=clipboard.readText();
 clipboard.writeText(String(text));
 try {await pressKey('cmd+v');if(pressEnter){await new Promise(r=>setTimeout(r,500));await pressKey('enter');}}
 finally {await new Promise(r=>setTimeout(r,150));clipboard.writeText(old);}
 return {success:true,typed:text,enterPressed:!!pressEnter};
}
module.exports={run,tool,browser,apple,quote,pressKey,typeText};
