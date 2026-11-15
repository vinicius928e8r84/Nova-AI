TARGET = iphone:clang:16.5:16.0
ARCHS = arm64
include $(THEOS)/makefiles/common.mk
TWEAK_NAME = NovaCamBridge
NovaCamBridge_FILES = Tweak.x
NovaCamBridge_CFLAGS = -fobjc-arc -Wno-deprecated-declarations
NovaCamBridge_FRAMEWORKS = UIKit AVFoundation CoreMedia CoreVideo CoreImage ImageIO QuartzCore
include $(THEOS_MAKE_PATH)/tweak.mk
