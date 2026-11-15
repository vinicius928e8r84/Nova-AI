'use strict';

function menuTemplate(platform) {
  const edit = {label: 'Editar', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]};
  if (platform === 'darwin') {
    return [
      {label: 'Nova AI', submenu: [{role: 'about'}, {type: 'separator'}, {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]},
      edit,
      {label: 'Visualizar', submenu: [{role: 'reload'}, {role: 'togglefullscreen'}, {role: 'toggleDevTools'}]},
      {label: 'Janela', submenu: [{role: 'minimize'}, {role: 'zoom'}, {role: 'front'}]}
    ];
  }
  if (platform === 'win32') {
    return [
      {label: 'Nova AI', submenu: [{role: 'quit'}]},
      edit,
      {label: 'Visualizar', submenu: [{role: 'reload'}, {role: 'togglefullscreen'}, {role: 'toggleDevTools'}]},
      {label: 'Janela', submenu: [{role: 'minimize'}, {role: 'close'}]}
    ];
  }
  return null;
}

function extraShutdownTasks({app, getIosBridge, rtmp, getTelegram}) {
  return [
    () => getIosBridge().stop(),
    () => app.camLiveService?.iphone.stop(),
    () => app.camLiveService?.stop(),
    () => app.liveCamBridgeService?.stopServer(),
    () => rtmp.stopBroadcast(),
    () => rtmp.stopRtmpServer(),
    () => getTelegram()?.stopConnectionCheck(),
  ];
}

async function runShutdownTasks(tasks, log = console.error) {
  const results = await Promise.allSettled(tasks.map(fn => Promise.resolve().then(fn)));
  for (const result of results) {
    if (result.status === 'rejected') log('[Shutdown]', result.reason);
  }
}

module.exports = {menuTemplate, extraShutdownTasks, runShutdownTasks};
