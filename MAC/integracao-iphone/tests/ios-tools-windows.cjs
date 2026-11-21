'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process');
const raiz=path.resolve(__dirname,'../../..');
const receitaRelativa='MAC/integracao-iphone/distribuicao/empacotar-ferramentas-windows.sh';
function posix(caminho,plataforma=process.platform){
 if(plataforma!=='win32')return caminho;
 const r=spawnSync('bash',['-c','cygpath -u "$1" 2>/dev/null || wslpath -u "$1"','_',caminho],{encoding:'utf8'});
 assert.equal(r.status,0,`sem cygpath/wslpath para ${caminho}: ${r.stderr}`);
 return r.stdout.trim();
}
function ambienteComPasta(pasta,env=process.env,delimitador=path.delimiter){
 const chave=Object.keys(env).find((k)=>k.toUpperCase()==='PATH')||'PATH';
 const resto=Object.fromEntries(Object.entries(env).filter(([k])=>k.toUpperCase()!=='PATH'));
 return{...resto,PATH:pasta+delimitador+(env[chave]||'')};
}
function rodarReceita(destino,env){
 return spawnSync('bash',[receitaRelativa,posix(destino)],{cwd:raiz,env,encoding:'utf8'});
}
function receitaComLdd(roteiro,antes){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'receita-'));
 const mingw=path.join(tmp,'ucrt64'),falso=path.join(tmp,'falso'),destino=path.join(tmp,'saida');
 fs.mkdirSync(path.join(mingw,'bin'),{recursive:true});fs.mkdirSync(falso);
 for(const n of ['iproxy','idevice_id','ideviceinfo','ideviceinstaller'])fs.writeFileSync(path.join(mingw,'bin',n+'.exe'),n);
 if(antes)antes(destino);
 fs.writeFileSync(path.join(falso,'ldd'),roteiro(mingw),{mode:0o755});
 const r=rodarReceita(destino,{...ambienteComPasta(falso),MINGW_PREFIX:posix(mingw),NOVA_INSTALAR_PACOTES:'0'});
 return{r,destino};
}
test('receita copia os 4 .exe e só as DLLs fora do Windows',()=>{
 const{r,destino}=receitaComLdd((m)=>{
  fs.writeFileSync(path.join(m,'bin','libusbmuxd-2.0.dll'),'dll');
  return `#!/bin/sh\necho "\\tlibusbmuxd-2.0.dll => ${posix(m)}/bin/libusbmuxd-2.0.dll (0x1)"\necho "\\tntdll.dll => /c/windows/SYSTEM32/ntdll.dll (0x2)"\n`;
 });
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(fs.readdirSync(path.join(destino,'bin')).sort(),['idevice_id.exe','ideviceinfo.exe','ideviceinstaller.exe','iproxy.exe','libusbmuxd-2.0.dll']);
 assert.ok(fs.existsSync(path.join(destino,'manifest.sha256')));
});
test('receita falha quando o ldd falha',()=>{
 const{r}=receitaComLdd(()=>'#!/bin/sh\nexit 1\n');
 assert.notEqual(r.status,0);
});
test('receita falha quando o ldd diz not found',()=>{
 const{r}=receitaComLdd(()=>'#!/bin/sh\nprintf "\\tlibz.dll => not found\\n"\n');
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/DLL ausente/);
});
test('receita copia DLL com espaço no caminho',()=>{
 const{r,destino}=receitaComLdd((m)=>{
  const pasta=path.join(m,'com espaco');fs.mkdirSync(pasta);fs.writeFileSync(path.join(pasta,'libx.dll'),'x');
  return `#!/bin/sh\necho "\tlibx.dll => ${posix(pasta)}/libx.dll (0x1)"\n`;
 });
 assert.equal(r.status,0,r.stderr);
 assert.ok(fs.existsSync(path.join(destino,'bin','libx.dll')));
});
test('receita limpa arquivo velho da pasta de saída',()=>{
 const{r,destino}=receitaComLdd(()=>'#!/bin/sh\nexit 0\n',(d)=>{
  fs.mkdirSync(path.join(d,'bin'),{recursive:true});fs.writeFileSync(path.join(d,'bin','velho.dll'),'v');
 });
 assert.equal(r.status,0,r.stderr);
 assert.ok(!fs.existsSync(path.join(destino,'bin','velho.dll')));
});
test('receita falha se faltar um .exe',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'receita-'));fs.mkdirSync(path.join(tmp,'bin'));
 const r=rodarReceita(path.join(tmp,'o'),{...process.env,MINGW_PREFIX:posix(tmp),NOVA_INSTALAR_PACOTES:'0'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Falta/);
});
test('PATH do ldd falso usa o delimitador da plataforma e uma chave só',()=>{
 const env=ambienteComPasta('C:\\falso',{Path:'C:\\Windows',HOME:'h'},';');
 assert.deepEqual(env,{HOME:'h',PATH:'C:\\falso;C:\\Windows'});
 assert.equal(posix('/tmp/x','linux'),'/tmp/x');
});
