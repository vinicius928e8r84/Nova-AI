const assert=require('node:assert/strict');
const Camera=require('../../app/electron/services/ios-camera');
(async()=>{
 const camera=new Camera({});
 camera.ssh=async()=>'';
 await camera.serve();
 const url='http://127.0.0.1:18999/frame.jpg';
 assert.equal((await fetch(url)).status,503,'Sem fonte deve responder 503');
 camera.pushFrame(Buffer.from([255,216,1,2,255,217]).toString('base64'));
 const response=await fetch(url);assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,6);
 camera.frameAt-=2000;assert.equal((await fetch(url)).status,503,'Quadro antigo não pode ser entregue como ao vivo');
 await camera.stop();assert.equal(camera.server,null);
 console.log('PASS: relé local, JPEG, rejeição de quadro antigo e fechamento');
})().catch(e=>{console.error(e);process.exitCode=1;});
