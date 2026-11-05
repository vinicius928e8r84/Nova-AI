THEOS_PACKAGE_SCHEME = rootless
TARGET = iphone:clang:16.5:16.0
ARCHS = arm64
include $(THEOS)/makefiles/common.mk
TWEAK_NAME = OBSGraphBridge
OBSGraphBridge_FILES = Tweak.x
OBSGraphBridge_CFLAGS = -fobjc-arc -Wno-unused-function
OBSGraphBridge_FRAMEWORKS = Foundation CoreMedia CoreVideo CoreGraphics CoreImage ImageIO QuartzCore
include $(THEOS_MAKE_PATH)/tweak.mk
