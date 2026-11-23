import speech_recognition as sr
import sys
import json
import contextlib

try:
    import sounddevice as sd
    class MacMicrophone(sr.AudioSource):
        def __init__(self):
            self.SAMPLE_RATE=16000
            self.SAMPLE_WIDTH=2
            self.CHUNK=1024
            self.stream=None
        def __enter__(self):
            parent=self
            self._input=sd.RawInputStream(samplerate=self.SAMPLE_RATE,blocksize=self.CHUNK,channels=1,dtype='int16')
            self._input.start()
            class Reader:
                def read(self,size):
                    data,_=parent._input.read(size)
                    return bytes(data)
            self.stream=Reader()
            return self
        def __exit__(self,*args):
            self._input.stop()
            self._input.close()
            self.stream=None
    sr.Microphone=MacMicrophone
except (ImportError, OSError):
    sd = None


SEM_PYAUDIO = "Microphone listener in background disabled (PyAudio not installed). Web/App voice mode active."
SEM_ENTRADA = "Microphone listener in background disabled (no usable input device). Web/App voice mode active."


def anunciar(registro):
    print(json.dumps(registro))
    sys.stdout.flush()


def informar(mensagem):
    anunciar({"type": "INFO", "msg": mensagem})


def conferir_entrada_do_mac(fonte):
    if sd is None or type(fonte).__name__ != 'MacMicrophone':
        return
    if isinstance(fonte, sr.AudioSource):
        sd.query_devices(kind='input')


def criar_microfone():
    try:
        fonte = sr.Microphone()
        conferir_entrada_do_mac(fonte)
    except Exception:
        informar(SEM_PYAUDIO)
        return None
    return fonte


def abrir_microfone(fonte):
    pilha = contextlib.ExitStack()
    try:
        pilha.enter_context(fonte)
    except Exception:
        informar(SEM_ENTRADA)
        return None
    return pilha


def tratar_fala(texto):
    gatilho = next((palavra for palavra in texto.split() if palavra.endswith("nic")), None)
    if gatilho:
        anunciar({"type": "WAKE_WORD", "text": texto, "command": texto.replace(gatilho, "", 1).strip()})
    else:
        informar(f"Heard: {texto}")


def ouvir_uma_vez(reconhecedor, fonte):
    try:
        audio = reconhecedor.listen(fonte, phrase_time_limit=10)
        tratar_fala(reconhecedor.recognize_google(audio).lower())
    except sr.UnknownValueError:
        pass
    except sr.RequestError:
        anunciar({"type": "ERROR", "msg": "Google Speech API Connection Issue"})
    except Exception as erro:
        anunciar({"type": "ERROR", "msg": str(erro)})


def listen_for_nova():
    reconhecedor = sr.Recognizer()
    reconhecedor.energy_threshold = 300
    reconhecedor.dynamic_energy_threshold = True
    fonte = criar_microfone()
    if fonte is None:
        return
    pilha = abrir_microfone(fonte)
    if pilha is None:
        return
    with pilha:
        informar("Microphone initialized. Tuning ambient noise...")
        reconhecedor.adjust_for_ambient_noise(fonte, duration=0.5)
        informar("NOVA Engine Active. Listening in background...")
        while True:
            ouvir_uma_vez(reconhecedor, fonte)

if __name__ == "__main__":
    try:
        listen_for_nova()
    except KeyboardInterrupt:
        sys.exit(0)
