import importlib.abc
import json
import runpy
import sys
import types


class Saida:
    def __init__(self):
        self.linhas = []
        self.pendente = ''

    def write(self, texto):
        self.pendente += texto
        while '\n' in self.pendente:
            linha, self.pendente = self.pendente.split('\n', 1)
            self.linhas.append(linha)
        return len(texto)

    def flush(self):
        self.linhas.append('«flush»')

    def anotar(self, texto):
        self.linhas.append(f'palco: {texto}')


class ImportacaoQueFalha(importlib.abc.MetaPathFinder):
    def __init__(self, erro):
        self.erro = erro

    def find_spec(self, nome, caminho, alvo=None):
        if nome == 'sounddevice':
            raise self.erro('sounddevice indisponível')
        return None


class Encenado:
    cena = {}
    saida = None


class RawInputStream(Encenado):
    def __init__(self, **opcoes):
        self.saida.anotar(f'RawInputStream {sorted(opcoes.items())}')
        if self.cena.get('stream_falha'):
            raise OSError('sem dispositivo de entrada')

    def start(self):
        self.saida.anotar('stream.start')

    def read(self, tamanho):
        self.saida.anotar(f'stream.read {tamanho}')
        return bytearray(b'\x01\x02'), False

    def stop(self):
        self.saida.anotar('stream.stop')

    def close(self):
        self.saida.anotar('stream.close')


def query_devices(kind):
    Encenado.saida.anotar(f'query_devices {kind}')
    if Encenado.cena.get('consulta_falha'):
        raise RuntimeError('sem dispositivos')


class AudioSource:
    pass


class UnknownValueError(Exception):
    pass


class RequestError(Exception):
    pass


class Microphone(AudioSource, Encenado):
    stream = None

    def __init__(self):
        self.saida.anotar('Microphone()')
        if self.cena.get('microfone_falha'):
            raise OSError('sem PyAudio')

    def __enter__(self):
        self.saida.anotar('Microphone.__enter__')
        if self.cena.get('entrada_falha'):
            raise OSError('sem dispositivo')
        return self

    def __exit__(self, *args):
        self.saida.anotar('Microphone.__exit__')


class Recognizer(Encenado):
    FALHAS_DO_RECONHECIMENTO = {'desconhecido': UnknownValueError, 'requisicao': RequestError, 'erro': RuntimeError}

    def __init__(self):
        self.falas = list(self.cena.get('falas', []))

    def adjust_for_ambient_noise(self, fonte, duration):
        self.saida.anotar(f'ajuste {type(fonte).__name__} {duration} {self.energy_threshold} {self.dynamic_energy_threshold}')

    def listen(self, fonte, phrase_time_limit):
        self.saida.anotar(f'listen {type(fonte).__name__} {phrase_time_limit}')
        if not self.falas:
            raise KeyboardInterrupt
        if fonte.stream is not None:
            self.saida.anotar(f'lido {list(fonte.stream.read(fonte.CHUNK))}')
        tipo, valor = self.falas.pop(0)
        if tipo == 'escuta_falha':
            raise ValueError(valor)
        return tipo, valor

    def recognize_google(self, audio):
        tipo, valor = audio
        if tipo in self.FALHAS_DO_RECONHECIMENTO:
            raise self.FALHAS_DO_RECONHECIMENTO[tipo](valor)
        return valor


def modulo_falso(nome, membros):
    modulo = types.ModuleType(nome)
    for membro in membros:
        setattr(modulo, membro.__name__, membro)
    return modulo


def preparar_sounddevice(cena):
    modo = cena.get('sounddevice', 'presente')
    if modo == 'presente':
        sys.modules['sounddevice'] = modulo_falso('sounddevice', [RawInputStream, query_devices])
        return
    sys.modules.pop('sounddevice', None)
    sys.meta_path.insert(0, ImportacaoQueFalha(ImportError if modo == 'ausente' else OSError))


def encenar(alvo, cena):
    saida = Saida()
    Encenado.cena = cena
    Encenado.saida = saida
    sys.modules['speech_recognition'] = modulo_falso('speech_recognition', [AudioSource, UnknownValueError, RequestError, Microphone, Recognizer])
    preparar_sounddevice(cena)
    original = sys.stdout
    sys.stdout = saida
    try:
        runpy.run_path(alvo, run_name='__main__')
        saida.anotar('fim sem exit')
    except SystemExit as saindo:
        saida.anotar(f'exit {saindo.code}')
    finally:
        sys.stdout = original
    if saida.pendente:
        saida.linhas.append(saida.pendente)
    return saida.linhas


if __name__ == '__main__':
    print(json.dumps(encenar(sys.argv[1], json.loads(sys.argv[2]))))
