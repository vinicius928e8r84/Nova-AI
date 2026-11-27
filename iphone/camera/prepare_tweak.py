from pathlib import Path
import re
import shutil
root=Path(__file__).parent/'tweak'
src=Path.home()/'Desktop/jailbreak/tweaks/vcamcaptura-consistente'
s=(src/'Tweak.x').read_text()
s=s[s.index('#import <AVFoundation'):s.index('// ---- Vídeo:')]
s=s.replace('VCamCaptura','NovaCamBridge').replace('VCCapturaMJPEG','NovaMJPEG')
s=re.sub(r'return @\[@"http://[^"]+/live\.mjpg",\n\s+@"http://[^"]+/live\.mjpg"\];','return @[@"http://127.0.0.1:18999/live.mjpg"];',s)
s=s.replace('@synchronized (_lock) { return _latest ? CGImageRetain(_latest) : NULL; }','@synchronized (_lock) { return (_latest && CACurrentMediaTime() - _lastFrameAt < 2.0) ? CGImageRetain(_latest) : NULL; }')
s=s.replace('        _latest = img;\n    }\n    _lastFrameAt = CACurrentMediaTime();','        _latest = img;\n        _lastFrameAt = CACurrentMediaTime();\n    }')
s += '''
// Preview only uses fresh source frames; no file is rewritten after recording.
static char kNovaOverlay;
static NSHashTable *novaPreviews;
static void novaUpdate(AVCaptureVideoPreviewLayer *preview) {
    CALayer *overlay = objc_getAssociatedObject(preview, &kNovaOverlay);
    CGImageRef image = [[NovaMJPEG shared] copyLatestImage];
    if (!image) { overlay.hidden = YES; return; }
    if (!overlay) {
        overlay = [CALayer layer];
        overlay.contentsGravity = kCAGravityResizeAspectFill;
        overlay.masksToBounds = YES;
        overlay.zPosition = 1000;
        [preview addSublayer:overlay];
        objc_setAssociatedObject(preview, &kNovaOverlay, overlay, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    overlay.frame = preview.bounds;
    overlay.contents = (__bridge id)image;
    overlay.hidden = NO;
    [CATransaction commit];
    CGImageRelease(image);
}
%hook AVCaptureVideoPreviewLayer
- (void)layoutSublayers {
    %orig;
    [novaPreviews addObject:self];
    novaUpdate(self);
}
%end
%ctor {
    dispatch_async(dispatch_get_main_queue(), ^{
        novaPreviews = [NSHashTable weakObjectsHashTable];
        [[NovaMJPEG shared] start];
        [NSTimer scheduledTimerWithTimeInterval:1.0/30 repeats:YES block:^(NSTimer *timer) {
            for (AVCaptureVideoPreviewLayer *preview in novaPreviews) novaUpdate(preview);
        }];
    });
}
'''
(root/'Tweak.x').write_text(s)
shutil.copy2(src/'PhotoPipeline.h',root/'PhotoPipeline.h')
(root/'Makefile').write_text('TARGET = iphone:clang:16.5:16.0\nARCHS = arm64\ninclude $(THEOS)/makefiles/common.mk\nTWEAK_NAME = NovaCamBridge\nNovaCamBridge_FILES = Tweak.x\nNovaCamBridge_CFLAGS = -fobjc-arc -Wno-deprecated-declarations\nNovaCamBridge_FRAMEWORKS = UIKit AVFoundation CoreMedia CoreVideo CoreImage ImageIO QuartzCore\ninclude $(THEOS_MAKE_PATH)/tweak.mk\n')
(root/'NovaCamBridge.plist').write_text('{ Filter = { Bundles = ( "com.apple.camera" ); }; };\n')
(root/'control').write_text('Package: com.aquiles.novacambridge\nName: Nova Camera Bridge\nDepends: mobilesubstrate\nVersion: 0.1-1\nArchitecture: iphoneos-arm64\nDescription: Nova USB camera preview and photo bridge. Video recording is unchanged.\nMaintainer: Aquiles\nAuthor: Aquiles\nSection: Tweaks\n')
