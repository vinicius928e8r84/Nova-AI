THEOS_PACKAGE_SCHEME = rootless
ARCHS = arm64
TARGET = iphone:clang:16.5:15.0

include $(THEOS)/makefiles/common.mk

TOOL_NAME = novaproxy

novaproxy_FILES = main.m ProxyConfig.m SysProxy.m Socks5.m Forwarder.m
novaproxy_CFLAGS = -fobjc-arc -Wno-deprecated-declarations -Wall
novaproxy_LDFLAGS = -framework Foundation -framework SystemConfiguration
novaproxy_CODESIGN_FLAGS = -Sentitlements.plist

include $(THEOS_MAKE_PATH)/tool.mk
