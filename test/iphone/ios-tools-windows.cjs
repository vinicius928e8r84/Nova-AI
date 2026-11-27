'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process');
const raiz=path.resolve(__dirname,'../..');
const receitaRelativa='distribuicao/empacotar-ferramentas-windows.sh';
function bashDoWsl(plataforma=process.platform){
 if(plataforma!=='win32')return false;
 const r=spawnSync('bash',['-c','uname -s'],{encoding:'utf8'});
 return r.status===0&&r.stdout.trim()==='Linux';
}
const pularNoWsl=bashDoWsl()&&'o bash do PATH é o do WSL, que não repassa as variáveis de ambiente do Node; rode com Git Bash ou MSYS2 na frente do PATH';
function posix(caminho,plataforma=process.platform){
 if(plataforma!=='win32')return caminho;
 const r=spawnSync('bash',['-c','cygpath -u "$1"','_',caminho],{encoding:'utf8'});
 assert.equal(r.status,0,`sem cygpath para ${caminho}: ${r.stderr}`);
 return r.stdout.trim();
}
const lddPelaVariavel='ldd(){ "$NOVA_LDD" "$@"; }; export -f ldd; exec bash "$@"';
function rodarReceita(destino,env){
 return spawnSync('bash',['-c',lddPelaVariavel,'_',receitaRelativa,posix(destino)],{cwd:raiz,env,encoding:'utf8'});
}
function receitaComLdd(roteiro,antes){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'receita-'));
 const mingw=path.join(tmp,'ucrt64'),falso=path.join(tmp,'falso'),destino=path.join(tmp,'saida');
 fs.mkdirSync(path.join(mingw,'bin'),{recursive:true});fs.mkdirSync(falso);
 for(const n of ['iproxy','idevice_id','ideviceinfo','ideviceinstaller'])fs.writeFileSync(path.join(mingw,'bin',n+'.exe'),n);
 if(antes)antes(destino);
 fs.writeFileSync(path.join(falso,'ldd'),roteiro(mingw),{mode:0o755});
 const r=rodarReceita(destino,{...process.env,NOVA_LDD:posix(path.join(falso,'ldd')),MINGW_PREFIX:posix(mingw),NOVA_INSTALAR_PACOTES:'0'});
 return{r,destino};
}
test('receita copia os 4 .exe e só as DLLs fora do Windows',{skip:pularNoWsl},()=>{
 const{r,destino}=receitaComLdd((m)=>{
  fs.writeFileSync(path.join(m,'bin','libusbmuxd-2.0.dll'),'dll');
  return `#!/bin/sh\necho "\\tlibusbmuxd-2.0.dll => ${posix(m)}/bin/libusbmuxd-2.0.dll (0x1)"\necho "\\tntdll.dll => /c/windows/SYSTEM32/ntdll.dll (0x2)"\n`;
 });
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(fs.readdirSync(path.join(destino,'bin')).sort(),['idevice_id.exe','ideviceinfo.exe','ideviceinstaller.exe','iproxy.exe','libusbmuxd-2.0.dll']);
 assert.ok(fs.existsSync(path.join(destino,'manifest.sha256')));
});
test('receita falha quando o ldd falha',{skip:pularNoWsl},()=>{
 const{r}=receitaComLdd(()=>'#!/bin/sh\nexit 1\n');
 assert.notEqual(r.status,0);
});
test('receita falha quando o ldd diz not found',{skip:pularNoWsl},()=>{
 const{r}=receitaComLdd(()=>'#!/bin/sh\nprintf "\\tlibz.dll => not found\\n"\n');
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/DLL ausente/);
});
test('receita copia DLL com espaço no caminho',{skip:pularNoWsl},()=>{
 const{r,destino}=receitaComLdd((m)=>{
  const pasta=path.join(m,'com espaco');fs.mkdirSync(pasta);fs.writeFileSync(path.join(pasta,'libx.dll'),'x');
  return `#!/bin/sh\necho "\tlibx.dll => ${posix(pasta)}/libx.dll (0x1)"\n`;
 });
 assert.equal(r.status,0,r.stderr);
 assert.ok(fs.existsSync(path.join(destino,'bin','libx.dll')));
});
test('receita limpa arquivo velho da pasta de saída',{skip:pularNoWsl},()=>{
 const{r,destino}=receitaComLdd(()=>'#!/bin/sh\nexit 0\n',(d)=>{
  fs.mkdirSync(path.join(d,'bin'),{recursive:true});fs.writeFileSync(path.join(d,'bin','velho.dll'),'v');
 });
 assert.equal(r.status,0,r.stderr);
 assert.ok(!fs.existsSync(path.join(destino,'bin','velho.dll')));
});
test('receita falha se faltar um .exe',{skip:pularNoWsl},()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'receita-'));fs.mkdirSync(path.join(tmp,'bin'));
 const r=rodarReceita(path.join(tmp,'o'),{...process.env,MINGW_PREFIX:posix(tmp),NOVA_INSTALAR_PACOTES:'0'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Falta/);
});
test('ldd falso entra por caminho absoluto em NOVA_LDD e vence o ldd do PATH',{skip:pularNoWsl},()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'receita-')),falso=path.join(tmp,'ldd');
 fs.writeFileSync(falso,'#!/bin/sh\necho falso "$1"\n',{mode:0o755});
 const r=spawnSync('bash',['-c',lddPelaVariavel,'_','-c','ldd x'],{env:{...process.env,NOVA_LDD:posix(falso)},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 assert.equal(r.stdout,'falso x\n');
});
test('só o bash do WSL é pulado e fora do Windows o caminho não muda',()=>{
 assert.equal(bashDoWsl('linux'),false);
 assert.equal(posix('/tmp/x','linux'),'/tmp/x');
});
