import speech_recognition as sr
import sys
import json

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


def listen_for_nova():
    r = sr.Recognizer()
    r.energy_threshold = 300
    r.dynamic_energy_threshold = True
    
    try:
        source = sr.Microphone()
        if sd is not None and isinstance(source, sr.AudioSource) and type(source).__name__ == 'MacMicrophone':
            sd.query_devices(kind='input')
    except Exception as e:
        print(json.dumps({"type": "INFO", "msg": f"Microphone listener in background disabled (PyAudio not installed). Web/App voice mode active."}))
        sys.stdout.flush()
        return

    with source:
        print(json.dumps({"type": "INFO", "msg": "Microphone initialized. Tuning ambient noise..."}))
        sys.stdout.flush()
        
        r.adjust_for_ambient_noise(source, duration=0.5)
        
        print(json.dumps({"type": "INFO", "msg": "NOVA Engine Active. Listening in background..."}))
        sys.stdout.flush()
        
        while True:
            try:
                audio = r.listen(source, phrase_time_limit=10)
                
                # Processing start log
                # print(json.dumps({"type": "INFO", "msg": "Voice detected, recognizing..."}))
                # sys.stdout.flush()

                text = r.recognize_google(audio).lower()
                words = text.split()
                trigger_word = next((w for w in words if w.endswith("nic")), None)
                
                if trigger_word:
                    # If we found a word ending in 'nic', trigger the AI
                    result = {
                        "type": "WAKE_WORD",
                        "text": text,
                        "command": text.replace(trigger_word, "", 1).strip()
                    }
                    print(json.dumps(result))
                    sys.stdout.flush()
                else:
                    # Log what was heard even if it wasn't a trigger word
                    print(json.dumps({"type": "INFO", "msg": f"Heard: {text}"}))
                    sys.stdout.flush()
                
            except sr.UnknownValueError:
                pass
            except sr.RequestError:
                print(json.dumps({"type": "ERROR", "msg": "Google Speech API Connection Issue"}))
                sys.stdout.flush()
            except Exception as e:
                # Critical error logger
                print(json.dumps({"type": "ERROR", "msg": str(e)}))
                sys.stdout.flush()

if __name__ == "__main__":
    try:
        listen_for_nova()
    except KeyboardInterrupt:
        sys.exit(0)
