#!/usr/bin/env python3
from pathlib import Path
import subprocess,sys,json,hashlib
root=Path(sys.argv[1]);errors=[];count=0;maximum=(0,0)
for p in root.rglob('*'):
 if p.is_symlink() or not p.is_file():continue
 with p.open('rb') as f:magic=f.read(4)
 if magic not in {b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe',b'\xbe\xba\xfe\xca'}:continue
 count+=1
 inspect=p
 if '(' in str(p):
  scratch=Path(__file__).resolve().parent/'inspecao-binarios';scratch.mkdir(exist_ok=True)
  inspect=scratch/(hashlib.sha256(str(p).encode()).hexdigest()+'.macho')
  if not inspect.is_symlink():inspect.symlink_to(p.resolve())
 text=subprocess.check_output(['/usr/bin/otool','-l',str(inspect)],text=True);command=''
 for line in text.splitlines():
  line=line.strip()
  if line.startswith('cmd '):command=line[4:]
  if command in ['LC_LOAD_DYLIB','LC_LOAD_WEAK_DYLIB','LC_REEXPORT_DYLIB'] and line.startswith('name '):
   dep=line[5:].split(' (offset')[0]
   if dep.startswith(('/opt/homebrew','/usr/local','/Users/')):errors.append({'file':str(p.relative_to(root)),'dependency':dep})
  if command=='LC_BUILD_VERSION' and line.startswith('minos '):
   v=tuple(int(x) for x in line[6:].split('.')[:2]);maximum=max(maximum,v)
print(json.dumps({'machOFiles':count,'minimumSystemRequired':'.'.join(map(str,maximum)),'externalDependencies':errors},indent=2))
raise SystemExit(1 if errors else 0)
