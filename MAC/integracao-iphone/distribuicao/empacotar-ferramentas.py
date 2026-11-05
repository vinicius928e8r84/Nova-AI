#!/usr/bin/env python3
"""Bundle installed iOS USB tools and their non-system dylibs for Apple Silicon."""
import hashlib,json,shutil,subprocess
from pathlib import Path
resources=Path('/Applications/Nova AI Mac.app/Contents/Resources')
root=resources/'ios-tools';(root/'bin').mkdir(parents=True,exist_ok=True);(root/'lib').mkdir(exist_ok=True)
mapping={};pending=[];manifest=[]
def deps(p):
    lines=subprocess.check_output(['/usr/bin/otool','-L',str(p)],text=True).splitlines()[1:]
    return [line.strip().split(' (compatibility')[0] for line in lines]
def register(src,kind):
    src=Path(src).resolve();dest=root/kind/src.name
    if src in mapping:return mapping[src]
    if dest in mapping.values():
        other=next(s for s,d in mapping.items() if d==dest)
        if hashlib.sha256(src.read_bytes()).digest()!=hashlib.sha256(other.read_bytes()).digest():raise RuntimeError(f'Conflicting library: {src.name}')
        return dest
    mapping[src]=dest;pending.append((src,dest));return dest
for name in ['iproxy','idevice_id','ideviceinfo','ideviceinstaller']:register('/opt/homebrew/bin/'+name,'bin')
i=0
while i<len(pending):
    src,dest=pending[i];i+=1
    for dep in deps(src):
        if dep.startswith('/opt/homebrew/'):register(dep,'lib')
        elif not dep.startswith(('/usr/lib/','/System/Library/')) and dep!=str(src):raise RuntimeError(f'Unresolved dependency: {dep}')
for src,dest in pending:
    shutil.copy2(src,dest);dest.chmod(0o755)
    args=['/usr/bin/install_name_tool']
    if dest.parent.name=='lib':args+=['-id','@loader_path/'+dest.name]
    for dep in deps(src):
        if dep.startswith('/opt/homebrew/'):
            target=mapping[Path(dep).resolve()]
            args+=['-change',dep,('@loader_path/../lib/' if dest.parent.name=='bin' else '@loader_path/')+target.name]
    if len(args)>1:subprocess.run(args+[str(dest)],check=True,capture_output=True)
    subprocess.run(['/usr/bin/codesign','--force','--sign','-',str(dest)],check=True,capture_output=True)
    manifest.append({'file':str(dest.relative_to(root)),'source':str(src),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'{len(pending)} executáveis/bibliotecas incluídos em {root}')
