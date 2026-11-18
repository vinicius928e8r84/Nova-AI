'use strict';
const fs=require('fs'),path=require('path');
// Only bundled USB tools: no Homebrew or personal PATH dependency.
function tool(name){
 if(!['iproxy','idevice_id','ideviceinfo','ideviceinstaller'].includes(name))throw new Error('Ferramenta iPhone desconhecida.');
 const root=process.resourcesPath||path.resolve(__dirname,'../../..');
 const file=path.join(root,'ios-tools','bin',name);
 try{fs.accessSync(file,fs.constants.X_OK);}catch{throw new Error('Ferramenta USB ausente no Nova: '+name+'. Reinstale o aplicativo completo.');}
 return file;
}
function tryTool(name){try{return tool(name);}catch{return null;}}
function has(name){return !!tryTool(name);}
function available(){return ['iproxy','idevice_id','ideviceinfo'].every(has);}
module.exports={tool,tryTool,has,available};
