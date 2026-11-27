THEOS_PACKAGE_SCHEME = rootless
TARGET = iphone:clang:16.5:16.0
ARCHS = arm64

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = NovaModel
NovaModel_FILES = Tweak.x
NovaModel_CFLAGS = -fobjc-arc -Wno-unused-function
NovaModel_FRAMEWORKS = Foundation

include $(THEOS_MAKE_PATH)/tweak.mk

TOOL_NAME = novamodel
novamodel_FILES = main.m
novamodel_CFLAGS = -fobjc-arc -Wall
novamodel_FRAMEWORKS = Foundation
novamodel_CODESIGN_FLAGS = -Sentitlements.plist

include $(THEOS_MAKE_PATH)/tool.mk
