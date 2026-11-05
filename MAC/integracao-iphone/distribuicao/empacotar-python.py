#!/usr/bin/env python3
import os,shutil,subprocess,json,hashlib
from pathlib import Path
resources=Path('/Applications/Nova AI Mac.app/Contents/Resources')
root=resources/'python-runtime-portable';version='3.15'
source=Path('/opt/homebrew/Cellar/python@3.15/3.15.2/Frameworks/Python.framework/Versions')/version
target=root/'Python.framework/Versions'/version
if target.exists():raise RuntimeError('Runtime já existe; não sobrescrevendo a compilação anterior.')
shutil.copytree(source,target,symlinks=True,ignore=shutil.ignore_patterns('site-packages','Headers','__pycache__'))
packages=target/'lib'/('python'+version)/'site-packages'
shutil.copytree(resources/'python-env/lib'/('python'+version)/'site-packages',packages,symlinks=True,ignore=shutil.ignore_patterns('__pycache__'))
# Build the source→destination map before rewriting dependencies.
mapping={};queue=[]
magic={b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe',b'\xbe\xba\xfe\xca'}
def macho(p):
 try:
  with p.open('rb') as f:return f.read(4) in magic
 except (OSError,IsADirectoryError):return False
def dependencies(p):
 return [l.strip().split(' (compatibility')[0] for l in subprocess.check_output(['/usr/bin/otool','-L',str(p)],text=True).splitlines() if l.startswith('\t')]
for p in target.rglob('*'):
 if p.is_symlink() or not p.is_file() or not macho(p):continue
 relative=p.relative_to(target)
 src=(resources/'python-env/lib'/('python'+version)/'site-packages'/p.relative_to(packages)) if p.is_relative_to(packages) else source/relative
 mapping[src.resolve()]=p;queue.append((src.resolve(),p))
(root/'lib').mkdir(exist_ok=True)
def add(src):
 src=src.resolve()
 if src in mapping:return mapping[src]
 dest=root/'lib'/src.name
 if dest in mapping.values():
  prior=next(s for s,d in mapping.items() if d==dest)
  if hashlib.sha256(prior.read_bytes()).digest()!=hashlib.sha256(src.read_bytes()).digest():raise RuntimeError('Library collision: '+str(src))
  mapping[src]=dest;return dest
 shutil.copy2(src,dest);mapping[src]=dest;queue.append((src,dest));return dest
add(Path('/opt/homebrew/opt/portaudio/lib/libportaudio.2.dylib'))
i=0
while i<len(queue):
 src,dest=queue[i];i+=1
 for dep in dependencies(src):
  if dep.startswith('/opt/homebrew/'):add(Path(dep))
  elif dep.startswith(('/usr/lib/','/System/Library/','@loader_path/','@executable_path/','@rpath/')):continue
  elif Path(dep).resolve()!=src:raise RuntimeError('Unexpected dependency: '+dep)
manifest=[]
for src,dest in queue:
 args=['/usr/bin/install_name_tool']
 if dest.suffix=='.dylib' or dest.name=='Python':args+=['-id','@loader_path/'+dest.name]
 for dep in dependencies(src):
  if dep.startswith('/opt/homebrew/'):
   d=mapping[Path(dep).resolve()];relative=os.path.relpath(d,dest.parent);args+=['-change',dep,'@loader_path/'+relative]
 if len(args)>1:subprocess.run(args+[str(dest)],check=True,capture_output=True)
 subprocess.run(['/usr/bin/codesign','--force','--sign','-',str(dest)],check=True,capture_output=True)
 manifest.append({'file':str(dest.relative_to(root)),'source':str(src)})
# sounddevice normally searches Homebrew at runtime; prefer the included PortAudio.
sounddevice=packages/'sounddevice.py';s=sounddevice.read_text()
s=s.replace("from ctypes.util import find_library as _find_library", "from ctypes.util import find_library as _system_find_library\ndef _find_library(name):\n    if name == 'portaudio':\n        return _os.path.join(_os.environ['NOVA_PYTHON_RUNTIME'], 'lib', 'libportaudio.2.dylib')\n    return _system_find_library(name)")
sounddevice.write_text(s)
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(root/'run-python').write_text('''#!/bin/sh
nova_runtime=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export NOVA_PYTHON_RUNTIME="$nova_runtime"
export PYTHONHOME="$nova_runtime/Python.framework/Versions/3.15"
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
export SSL_CERT_FILE="$PYTHONHOME/lib/python3.15/site-packages/certifi/cacert.pem"
export REQUESTS_CA_BUNDLE="$SSL_CERT_FILE"
unset PYTHONPATH
exec "$PYTHONHOME/bin/python3.15" "$@"
''');(root/'run-python').chmod(0o755)
framework=root/'Python.framework'
for link,to in [(framework/'Versions/Current',version),(framework/'Python','Versions/Current/Python'),(framework/'Resources','Versions/Current/Resources')]:
 if not link.exists() and not link.is_symlink():link.symlink_to(to)
print('Python portátil criado:',len(queue),'arquivos Mach-O')
