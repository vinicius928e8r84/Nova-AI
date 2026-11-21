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


def montar_sounddevice(cena, saida):
    sd = types.ModuleType('sounddevice')

    class RawInputStream:
        def __init__(self, **opcoes):
            saida.anotar(f'RawInputStream {sorted(opcoes.items())}')
            if cena.get('stream_falha'):
                raise OSError('sem dispositivo de entrada')

        def start(self):
            saida.anotar('stream.start')

        def read(self, tamanho):
            saida.anotar(f'stream.read {tamanho}')
            return bytearray(b'\x01\x02'), False

        def stop(self):
            saida.anotar('stream.stop')

        def close(self):
            saida.anotar('stream.close')

    def query_devices(kind):
        saida.anotar(f'query_devices {kind}')
        if cena.get('consulta_falha'):
            raise RuntimeError('sem dispositivos')

    sd.RawInputStream = RawInputStream
    sd.query_devices = query_devices
    return sd


def montar_speech_recognition(cena, saida):
    sr = types.ModuleType('speech_recognition')

    class AudioSource:
        pass

    class UnknownValueError(Exception):
        pass

    class RequestError(Exception):
        pass

    class Microphone(AudioSource):
        def __init__(self):
            saida.anotar('Microphone()')
            if cena.get('microfone_falha'):
                raise OSError('sem PyAudio')

        def __enter__(self):
            saida.anotar('Microphone.__enter__')
            if cena.get('entrada_falha'):
                raise OSError('sem dispositivo')
            return self

        def __exit__(self, *args):
            saida.anotar('Microphone.__exit__')

    falhas_do_reconhecimento = {'desconhecido': UnknownValueError, 'requisicao': RequestError, 'erro': RuntimeError}

    class Recognizer:
        def __init__(self):
            self.falas = list(cena.get('falas', []))

        def adjust_for_ambient_noise(self, fonte, duration):
            saida.anotar(f'ajuste {type(fonte).__name__} {duration} {self.energy_threshold} {self.dynamic_energy_threshold}')

        def listen(self, fonte, phrase_time_limit):
            saida.anotar(f'listen {type(fonte).__name__} {phrase_time_limit}')
            if not self.falas:
                raise KeyboardInterrupt
            if fonte.stream is not None:
                saida.anotar(f'lido {list(fonte.stream.read(fonte.CHUNK))}')
            tipo, valor = self.falas.pop(0)
            if tipo == 'escuta_falha':
                raise ValueError(valor)
            return tipo, valor

        def recognize_google(self, audio):
            tipo, valor = audio
            if tipo in falhas_do_reconhecimento:
                raise falhas_do_reconhecimento[tipo](valor)
            return valor

    Microphone.stream = None
    sr.AudioSource = AudioSource
    sr.UnknownValueError = UnknownValueError
    sr.RequestError = RequestError
    sr.Microphone = Microphone
    sr.Recognizer = Recognizer
    return sr


def preparar_sounddevice(cena, saida):
    modo = cena.get('sounddevice', 'presente')
    if modo == 'presente':
        sys.modules['sounddevice'] = montar_sounddevice(cena, saida)
        return
    sys.modules.pop('sounddevice', None)
    sys.meta_path.insert(0, ImportacaoQueFalha(ImportError if modo == 'ausente' else OSError))


def encenar(alvo, cena):
    saida = Saida()
    sys.modules['speech_recognition'] = montar_speech_recognition(cena, saida)
    preparar_sounddevice(cena, saida)
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
    print(json.dumps(encenar(sys.argv[1], json.loads(sys.argv[2])), ensure_ascii=False))
