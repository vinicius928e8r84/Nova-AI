import subprocess

OTOOL = '/usr/bin/otool'
INSTALL_NAME_TOOL = '/usr/bin/install_name_tool'
CODESIGN = '/usr/bin/codesign'
HOMEBREW = '/opt/homebrew/'
PREFIXOS_DO_SISTEMA = ('/usr/lib/', '/System/Library/', '@loader_path/', '@executable_path/', '@rpath/')
MAGIA_DO_MACH_O = {b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca'}


def e_mach_o(caminho):
    try:
        with caminho.open('rb') as arquivo:
            return arquivo.read(4) in MAGIA_DO_MACH_O
    except (OSError, IsADirectoryError):
        return False


def dependencias(caminho):
    saida = subprocess.check_output([OTOOL, '-L', str(caminho)], text=True)
    return [linha.strip().split(' (compatibility')[0] for linha in saida.splitlines() if linha.startswith('\t')]
