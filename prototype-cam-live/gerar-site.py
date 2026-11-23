#!/usr/bin/env python3
"""Gera index.html autocontido a partir de ../MAC/integracao-camlive (módulo real). Rode de novo depois de mudar os módulos."""
import re, pathlib
here = pathlib.Path(__file__).parent
mod = here.parent / 'app' / 'dist'
src = (here / 'index.template.html').read_text(encoding='utf8')
def inline(name):
    code = (mod / name).read_text(encoding='utf8').replace('</script', '<\\/script')
    return f'<script>\n/* {name} */\n{code}\n</script>'
for name in ['cam-live-audio.js', 'cam-live-dados.js', 'cam-live-modelo.js', 'cam-live.js']:
    src = src.replace(f'<script src="../app/dist/{name}"></script>', inline(name))
(here / 'index.html').write_text(src, encoding='utf8')
print('index.html gerado,', len(src) // 1024, 'KB')
