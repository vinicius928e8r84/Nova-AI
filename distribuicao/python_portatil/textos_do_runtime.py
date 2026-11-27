LINHA_DO_FIND_LIBRARY = "from ctypes.util import find_library as _find_library"
FIND_LIBRARY_DO_PORTAUDIO = (
    "from ctypes.util import find_library as _system_find_library\n"
    "def _find_library(name):\n"
    "    if name == 'portaudio':\n"
    "        return _os.path.join(_os.environ['NOVA_PYTHON_RUNTIME'], 'lib', 'libportaudio.2.dylib')\n"
    "    return _system_find_library(name)"
)

RUN_PYTHON = '''#!/bin/sh
nova_runtime=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export NOVA_PYTHON_RUNTIME="$nova_runtime"
export PYTHONHOME="$nova_runtime/Python.framework/Versions/3.15"
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
export SSL_CERT_FILE="$PYTHONHOME/lib/python3.15/site-packages/certifi/cacert.pem"
export REQUESTS_CA_BUNDLE="$SSL_CERT_FILE"
unset PYTHONPATH
exec "$PYTHONHOME/bin/python3.15" "$@"
'''
