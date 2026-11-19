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
function userDataBrowsers() {
  try {return path.join(require('electron').app.getPath('userData'),'browsers');} catch {return null;}
}
function browser(kind='chrome') {
  const names={chrome:['Google Chrome','Google Chrome for Testing'],brave:['Brave Browser'],vivaldi:['Vivaldi'],firefox:['Firefox'],edge:['Microsoft Edge']};
  const bundledRoots=[process.resourcesPath&&path.join(process.resourcesPath,'browsers'),path.join(__dirname,'../../browsers'),userDataBrowsers()].filter(Boolean);
  for(const name of names[kind]||names.chrome) {
    const exe=name==='Firefox'?'firefox':name;
    const apps=[...['/Applications',path.join(os.homedir(),'Applications')].map(root=>path.join(root,name+'.app')),...bundledRoots.map(root=>path.join(root,kind,name+'.app'))];
    for(const app of apps) {
      const p=path.join(app,'Contents','MacOS',exe);
      if(fs.existsSync(p)) return p;
    }
  }
  if(kind==='chrome') {
    const {findBundledChromiumExecutable}=require('./platform-utils');
    const p=findBundledChromiumExecutable(bundledRoots);
    if(p)return p;
    try {const p=require('playwright').chromium.executablePath();if(fs.existsSync(p))return p;}catch{}
  }
  return null;
}
function apple(script){return run('/usr/bin/osascript',['-e',script]);}
const quote = s=>JSON.stringify(String(s));
async function pressKey(key) {
  const pieces=String(key).toLowerCase().split('+');let name=pieces.pop();
  const mods=pieces.map(p=>({ctrl:'command down',control:'command down',cmd:'command down',command:'command down',alt:'option down',option:'option down',shift:'shift down',meta:'command down'})[p]);
  if(mods.some(m=>!m))throw new Error('Unknown key modifier');
  const codes={enter:36,return:36,tab:48,escape:53,backspace:51,delete:117,up:126,down:125,left:123,right:124,home:115,end:119,pageup:116,pagedown:121,f1:122,f2:120,f3:99,f4:118,f5:96,f6:97,f7:98,f8:100,f9:101,f10:109,f11:103,f12:111};
  if(key.toLowerCase()==='alt+f4'){name='w';mods.splice(0,mods.length,'command down');}
  if(key.toLowerCase()==='alt+tab'){name='tab';mods.splice(0,mods.length,'command down');}
  if(!(name in codes)&&name.length!==1)throw new Error('Unknown key: '+key);
  const action=name in codes?'key code '+codes[name]:'keystroke '+quote(name);
  await apple(`tell application "System Events" to ${action}${mods.length?' using {'+mods.join(',')+'}':''}`);
  return {success:true,key};
}
async function typeText(text,pressEnter=false) {
 const {clipboard}=require('electron');const old=clipboard.readText();
 clipboard.writeText(String(text));
 try {await pressKey('cmd+v');if(pressEnter){await new Promise(r=>setTimeout(r,500));await pressKey('enter');}}
 finally {await new Promise(r=>setTimeout(r,150));clipboard.writeText(old);}
 return {success:true,typed:text,enterPressed:!!pressEnter};
}
function python() {
 const roots=[process.resourcesPath,path.join(__dirname,'../../resources')].filter(Boolean);
 for(const root of roots){const p=path.join(root,'python-runtime-portable/run-python');if(fs.existsSync(p))return p;}
 for(const root of roots){const p=path.join(root,'python-env/bin/python3');if(fs.existsSync(p))return p;}
 return tool('python3')||'/usr/bin/python3';
}
module.exports={run,tool,browser,apple,quote,pressKey,typeText,python};
