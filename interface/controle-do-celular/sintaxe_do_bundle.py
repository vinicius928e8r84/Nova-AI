import pathlib
import subprocess
import tempfile


def conferir_com_o_node(texto, nome_do_arquivo):
    with tempfile.TemporaryDirectory() as pasta:
        prova = pathlib.Path(pasta) / nome_do_arquivo
        prova.write_text(texto, encoding='utf-8')
        return subprocess.run(['node', '--check', str(prova)], capture_output=True, text=True)
