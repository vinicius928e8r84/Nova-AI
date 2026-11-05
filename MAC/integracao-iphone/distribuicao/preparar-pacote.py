#!/usr/bin/env python3
"""Create a clean, shareable Mac app copy, keeping user data outside the package."""
from pathlib import Path
import datetime,shutil,plistlib,json,tempfile
source=Path('/Applications/Nova AI Mac.app')
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
stage=Path(tempfile.mkdtemp(prefix='nova-ai-release-'+stamp+'-'))
app=stage/source.name

def ignore(directory,names):
 p=Path(directory);skip=set()
 if p==source/'Contents/Resources':skip|={'python-runtime','python-env'}
 if p.name=='browsers':skip.add('.links')
 if p==source/'Contents/Resources/app/electron/services/iphone-setup':skip.add('setup.test.cjs')
 return skip
shutil.copytree(source,app,symlinks=True,ignore=ignore)
info=app/'Contents/Info.plist';data=plistlib.loads(info.read_bytes());data['CFBundleVersion']='20261103.1';data['LSMinimumSystemVersion']='26.0';info.write_bytes(plistlib.dumps(data))
resources=app/'Contents/Resources'
# Package metadata uses relative component paths and carries no source-machine paths.
for p in [resources/'ios-tools/manifest.json',resources/'python-runtime-portable/manifest.json']:
 rows=json.loads(p.read_text());p.write_text(json.dumps([{k:v for k,v in row.items() if k!='source'} for row in rows],indent=2)+'\n')
(stage/'LEIA-ME.txt').write_text('''NOVA AI MAC — versão local de 03/11/2026
Compatibilidade deste pacote: Apple Silicon, macOS 26 ou superior.

Arraste Nova AI Mac para Aplicativos. O aplicativo tem assinatura local e não é notarizado pela Apple.
Na primeira abertura, o macOS pode exigir liberação em Ajustes do Sistema > Privacidade e Segurança.

Incluído: Electron, FFmpeg, ADB/scrcpy, ferramentas USB iPhone, Python/PortAudio e Chromium.
Não é necessário instalar Homebrew, Python ou Chrome para os componentes incluídos.
O aplicativo usa os recursos do computador em que está instalado.

Cada pessoa configura suas próprias contas, chaves de IA e permissões do macOS.
Os serviços de IA, reconhecimento de fala Google e integrações online continuam exigindo internet.
Não foram incluídos dados de Application Support, perfis pessoais de navegador ou chaves SSH do criador.

iPhone: jailbreak ativo e OpenSSH já instalado; desbloqueie e confirme Confiar neste computador.
No Nova, selecione Conectar e informe a senha SSH mobile. A senha não é salva.
Controle de tela exige CatVNC instalado e configurado no iPhone.
A ponte de câmera incluída é 0.1-30, destinada ao iPhone 8 Plus iPhone10,2 / iOS 16.7.16.
Outras versões existentes da ponte são preservadas. 0.1-38 ainda exige adaptação/validação no Nova.
Não há garantia de todas as funções em todos os iPhones. Funções exclusivas do Android não ganham suporte iOS por este empacotamento.
O pipeline de upload automático do YouTube não acompanha o app original e não está funcional.

Pacote ainda requer teste em outro Mac limpo; não é uma versão Windows nem Intel.
''')
framework=resources/'python-runtime-portable/Python.framework'
for link,to in [(framework/'Versions/Current','3.15'),(framework/'Python','Versions/Current/Python'),(framework/'Resources','Versions/Current/Resources')]:
 if not link.exists() and not link.is_symlink():link.symlink_to(to)
for p in app.rglob('*'):
 if p.is_file() and not p.is_symlink():p.chmod(p.stat().st_mode|0o200)
(stage/'Aplicativos').symlink_to('/Applications')
print(stage)
