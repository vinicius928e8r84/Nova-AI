'use strict';
const fs=require('fs');
// Only bundled USB tools: no Homebrew or personal PATH dependency.
function tool(name){
 if(!['iproxy','idevice_id','ideviceinfo','ideviceinstaller'].includes(name))throw new Error('Ferramenta iPhone desconhecida.');
 const file=require('./tool-paths').iosTool(name);
 try{fs.accessSync(file,fs.constants.X_OK);}catch{throw new Error('Ferramenta USB ausente no Nova: '+name+'. Reinstale o aplicativo completo.');}
 return file;
}
function tryTool(name){try{return tool(name);}catch{return null;}}
function has(name){return !!tryTool(name);}
function available(){return ['iproxy','idevice_id','ideviceinfo'].every(has);}
const USBMUXD=/usbmuxd|Unable to retrieve device list/i;
function dicaUsbmuxd(stderr,platform=process.platform){
 return platform==='win32'&&USBMUXD.test(String(stderr||''))?'Não consegui falar com o iPhone por USB. Instale o Apple Devices (Microsoft Store) ou o iTunes, conecte o cabo e toque em "Confiar" no aparelho.':null;
}
module.exports={tool,tryTool,has,available,dicaUsbmuxd};
