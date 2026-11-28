#!/bin/bash
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
exec bash "$AQUI/caracterizacao.sh"
