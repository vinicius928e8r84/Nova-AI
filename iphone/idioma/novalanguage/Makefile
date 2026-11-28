THEOS_PACKAGE_SCHEME = rootless
ARCHS = arm64
TARGET = iphone:clang:16.5:15.0

include $(THEOS)/makefiles/common.mk

TOOL_NAME = novalanguage

novalanguage_FILES = main.m Comandos.m Opcoes.m Preferencias.m Saida.m Validacao.m Varredura.m
novalanguage_CFLAGS = -fobjc-arc -Wall -fvisibility=hidden
novalanguage_LDFLAGS = -framework Foundation

include $(THEOS_MAKE_PATH)/tool.mk
