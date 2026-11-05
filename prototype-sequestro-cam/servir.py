#!/usr/bin/env python3
"""Site de teste do SEQUESTRO DE CÂMERA (só item 3) com on/off REAL.

Serve a index.html e uma API local que executa o sistema do jailbreak:
  GET  /api/status  -> ./phone.sh status          (+ checagem do relé OBS 8900)
  POST /api/on      -> ./phone.sh enable-all       (túnel USB + injeção em qualquer app: Câmera, Safari e demais)
  POST /api/off     -> ./phone.sh disable         (volta para a câmera real)

O phone.sh pede autenticação interativa quando não existe conexão-mestre SSH.
Aqui a mestra é aberta antes com a chave ~/.ssh/id_iphone (a mesma do app),
no mesmo ControlPath que o phone.sh reutiliza.

Uso:  python3 servir.py   ->  http://127.0.0.1:8788
"""
import json
import os
import subprocess
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

AQUI = Path(__file__).resolve().parent
BRIDGE = Path('/Users/aquilesneri/Desktop/jailbreak/obs-camera-source/bridge')
PORTA = 8788
RELE = 'http://127.0.0.1:8900/frame.jpg'
CHAVE = os.path.expanduser('~/.ssh/id_iphone')

DIR_CONTROLE = f'/tmp/vcampipeline-ssh-{os.getuid()}'
CONTROLE = f'{DIR_CONTROLE}/control'
SSH_BASE = ['/usr/bin/ssh', '-p', '2222', '-i', CHAVE, '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
            '-o', 'ControlMaster=auto', '-o', 'ControlPersist=600',
            '-o', f'ControlPath={CONTROLE}']


def mestre_ativo():
    r = subprocess.run(SSH_BASE + ['-O', 'check', 'mobile@127.0.0.1'],
                       capture_output=True, text=True, timeout=10)
    return r.returncode == 0


def garantir_mestre():
    """Abre a conexão-mestre com a chave, no ControlPath usado pelo phone.sh."""
    d = Path(DIR_CONTROLE)
    if not d.exists():
        d.mkdir(mode=0o700)
    if mestre_ativo():
        return
    subprocess.run(SSH_BASE + ['-f', '-N', 'mobile@127.0.0.1'],
                   capture_output=True, text=True, timeout=15)
    for _ in range(10):
        if mestre_ativo():
            return
        time.sleep(0.3)
    raise RuntimeError('Não foi possível abrir o túnel SSH com o iPhone (conecte por USB).')


def rodar(comando, timeout):
    garantir_mestre()
    p = subprocess.run(['./phone.sh', comando], cwd=BRIDGE, capture_output=True,
                       text=True, timeout=timeout)
    saida = (p.stdout + p.stderr).strip()
    return p.returncode, saida


def relay_vivo():
    try:
        with urllib.request.urlopen(RELE, timeout=1.5) as r:
            return r.status in (200, 503)  # 503 = relé no ar sem quadro recente
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, codigo=200):
        corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            corpo = (AQUI / 'index.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
        elif self.path == '/api/status':
            try:
                codigo, saida = rodar('status', 15)
                bridge = json.loads(saida) if codigo == 0 else None
                self._json({'ok': codigo == 0, 'bridge': bridge,
                            'rele': relay_vivo(),
                            'erro': None if codigo == 0 else saida[-400:]})
            except Exception as e:
                self._json({'ok': False, 'bridge': None, 'rele': relay_vivo(), 'erro': str(e)})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/api/on':
            try:
                codigo, saida = rodar('enable-all', 90)
                if codigo == 0:
                    msg = 'Injeção ligada para qualquer app (Câmera, Safari e demais): visor, foto, vídeo e áudio do OBS. Feche e reabra o app da câmera.'
                    if not relay_vivo():
                        msg += ' Aviso: o relé do OBS (porta 8900) não respondeu — ligue o OBS e o relay.py.'
                    self._json({'ok': True, 'mensagem': msg})
                else:
                    self._json({'ok': False, 'mensagem': saida[-400:] or 'phone.sh falhou'})
            except subprocess.TimeoutExpired:
                self._json({'ok': False, 'mensagem': 'Tempo esgotado ao ligar (iPhone conectado por USB?)'})
            except Exception as e:
                self._json({'ok': False, 'mensagem': str(e)})
        elif self.path == '/api/off':
            try:
                codigo, saida = rodar('disable', 30)
                msg = ('Injeção desligada. Feche e reabra a Câmera para voltar ao sensor real.'
                       if codigo == 0 else (saida[-400:] or 'phone.sh falhou'))
                self._json({'ok': codigo == 0, 'mensagem': msg})
            except Exception as e:
                self._json({'ok': False, 'mensagem': str(e)})
        else:
            self.send_error(404)

    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    print(f'Seite de teste do Sequestro de Câmera: http://127.0.0.1:{PORTA}')
    ThreadingHTTPServer(('127.0.0.1', PORTA), Handler).serve_forever()
