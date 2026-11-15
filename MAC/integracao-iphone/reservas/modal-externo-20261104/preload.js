const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('iphoneSetup',{console:()=>ipcRenderer.invoke('nova:iphone-console'),connect:password=>ipcRenderer.invoke('nova:iphone-setup',password)});
