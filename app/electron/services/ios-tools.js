'use strict';
const fs=require('fs');
// Only bundled USB tools: no Homebrew or personal PATH dependency.
function tool(name){
 if(!['iproxy','idevice_id','ideviceinfo','ideviceinstaller'].includes(name))throw new Error('Ferramenta iPhone desconhecida.');
 const file=require('./tool-paths').iosTool(name);
 try{fs.accessSync(file,fs.constants.X_OK);}catch{throw new Error('Ferramenta USB ausente no Nova: '+name+'. Reinstale o aplicativo completo.');}
 return file;
}
module.exports={tool};
