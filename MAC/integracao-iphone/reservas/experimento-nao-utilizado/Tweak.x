#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

static void vclog(NSString *fmt, ...) {
    va_list args;
    va_start(args, fmt);
    NSString *msg = [[NSString alloc] initWithFormat:fmt arguments:args];
    va_end(args);
    NSLog(@"[NovaCamBridge] %@", msg);
}

// ---- Cliente MJPEG: mesmo servidor do Mac que a pré-visualização já usa (porta 8899) ----
// Conectado o tempo todo enquanto o app Câmera estiver na frente; entrega sempre o quadro
// mais novo que chegou do OBS.

static NSArray<NSString *> *mjpegURLs() {
    return @[@"http://127.0.0.1:18999/live.mjpg"];
}

@interface NovaMJPEG : NSObject <NSURLSessionDataDelegate>
+ (instancetype)shared;
- (void)start;
- (CGImageRef)copyLatestImage; // +1; NULL até chegar o primeiro quadro
@end

@implementation NovaMJPEG {
    NSURLSession *_session;
    NSURLSessionDataTask *_task;
    NSMutableData *_buf;
    dispatch_queue_t _decodeQueue;
    NSObject *_lock;
    NSData *_pending;
    BOOL _decoding;
    CGImageRef _latest;
    BOOL _started;
    unsigned long _received, _shown;
    NSUInteger _urlIndex, _connectCount, _receivedAtConnect;
    NSTimer *_timer;
    CFTimeInterval _lastFrameAt, _connectedAt;
}

+ (instancetype)shared {
    static NovaMJPEG *inst;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ inst = [NovaMJPEG new]; });
    return inst;
}

- (void)start {
    if (_started) return;
    _started = YES;
    _lock = [NSObject new];
    _decodeQueue = dispatch_queue_create("vcammin.captura.decode", DISPATCH_QUEUE_SERIAL);

    NSURLSessionConfiguration *cfg = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    cfg.timeoutIntervalForRequest = 10;
    cfg.timeoutIntervalForResource = 86400;
    cfg.requestCachePolicy = NSURLRequestReloadIgnoringLocalAndRemoteCacheData;
    NSOperationQueue *q = [NSOperationQueue new];
    q.maxConcurrentOperationCount = 1;
    _session = [NSURLSession sessionWithConfiguration:cfg delegate:self delegateQueue:q];

    [self connect];
    _timer = [NSTimer scheduledTimerWithTimeInterval:1.0 repeats:YES block:^(NSTimer *t) { [self tick]; }];
}

- (void)connect {
    [_task cancel];
    if (_connectCount++ > 0 && _received == _receivedAtConnect) _urlIndex++;
    _receivedAtConnect = _received;
    NSArray<NSString *> *urls = mjpegURLs();
    NSString *urlString = urls[_urlIndex % urls.count];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:urlString]
                                                       cachePolicy:NSURLRequestReloadIgnoringLocalAndRemoteCacheData
                                                   timeoutInterval:10];
    _task = [_session dataTaskWithRequest:req];
    _connectedAt = CACurrentMediaTime();
    [_task resume];
    vclog(@"mjpeg: conectando em %@", urlString);
}

- (void)tick {
    CFTimeInterval now = CACurrentMediaTime();
    CFTimeInterval last = MAX(_lastFrameAt, _connectedAt);
    if (now - last > 4) {
        vclog(@"mjpeg: sem quadros há %.0fs, reconectando", now - last);
        [self connect];
    }
}

- (CGImageRef)copyLatestImage {
    @synchronized (_lock) { return (_latest && CACurrentMediaTime() - _lastFrameAt < 2.0) ? CGImageRetain(_latest) : NULL; }
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task
didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))handler {
    if (task == _task) {
        _buf = [NSMutableData data];
        vclog(@"mjpeg: resposta HTTP %ld", (long)((NSHTTPURLResponse *)response).statusCode);
    }
    handler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    if (task != _task) return;
    vclog(@"mjpeg: conexão encerrada (%@)", error.localizedDescription ?: @"sem erro");
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (task == self->_task) [self connect];
    });
}

// Corta o fluxo em JPEGs (FFD8 ... FFD9) e guarda só o mais novo.
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
    if (task != _task || !_buf) return;
    static const uint8_t kSOI[2] = {0xFF, 0xD8};
    static const uint8_t kEOI[2] = {0xFF, 0xD9};

    [_buf appendData:data];
    const uint8_t *b = _buf.bytes;
    NSUInteger n = _buf.length, pos = 0, keep = 0;
    NSRange newest = NSMakeRange(NSNotFound, 0);

    while (pos + 4 <= n) {
        const uint8_t *s = memmem(b + pos, n - pos, kSOI, 2);
        if (!s) { keep = n - 1; break; }
        NSUInteger si = (NSUInteger)(s - b);
        const uint8_t *e = memmem(b + si + 2, n - si - 2, kEOI, 2);
        if (!e) { keep = si; break; }
        NSUInteger ei = (NSUInteger)(e - b) + 2;
        newest = NSMakeRange(si, ei - si);
        pos = ei;
        keep = ei;
    }
    if (newest.location != NSNotFound) {
        [self submit:[NSData dataWithBytes:b + newest.location length:newest.length]];
    }
    if (keep > 0) [_buf replaceBytesInRange:NSMakeRange(0, keep) withBytes:NULL length:0];
    if (_buf.length > 4 * 1024 * 1024) [_buf setLength:0];
}

- (void)submit:(NSData *)jpeg {
    _received++;
    BOOL start = NO;
    @synchronized (_lock) {
        _pending = jpeg;
        if (!_decoding) { _decoding = YES; start = YES; }
    }
    if (!start) return;
    dispatch_async(_decodeQueue, ^{
        for (;;) {
            NSData *d;
            @synchronized (self->_lock) {
                d = self->_pending;
                self->_pending = nil;
                if (!d) { self->_decoding = NO; return; }
            }
            [self decode:d];
        }
    });
}

- (void)decode:(NSData *)d {
    CGImageSourceRef src = CGImageSourceCreateWithData((__bridge CFDataRef)d, NULL);
    if (!src) return;
    CGImageRef img = CGImageSourceCreateImageAtIndex(src, 0,
        (__bridge CFDictionaryRef)@{(id)kCGImageSourceShouldCacheImmediately: @YES});
    CFRelease(src);
    if (!img) return;
    @synchronized (_lock) {
        if (_latest) CGImageRelease(_latest);
        _latest = img;
        _lastFrameAt = CACurrentMediaTime();
    }
    if (++_shown == 1) vclog(@"mjpeg: primeiro quadro recebido");
}
@end

// ---- Compor o quadro do OBS num tamanho/formato específico (aspect-fill, igual ao preview) ----

#import "PhotoPipeline.h"

static CVPixelBufferRef renderOBSPixelBuffer(CGImageRef cg, size_t w, size_t h) {
    ensureCI();
    CIImage *img = fitImage(cg, w, h);
    if (!img) return NULL;
    NSDictionary *attrs = @{(id)kCVPixelBufferIOSurfacePropertiesKey: @{}};
    CVPixelBufferRef buf = NULL;
    CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, (__bridge CFDictionaryRef)attrs, &buf);
    if (!buf) return NULL;
    [g_ci render:img toCVPixelBuffer:buf bounds:CGRectMake(0, 0, w, h) colorSpace:g_cs];
    return buf;
}

// Each AVCapturePhoto freezes one source frame and one encoded result. No
// second network read between the full-size image and its previews.
@interface VCCPhotoSnapshot : NSObject
@property (nonatomic, strong) id image;
@property (nonatomic, strong) NSData *data;
@property (nonatomic) BOOL attempted;
@property (nonatomic) BOOL failed;
@end
@implementation VCCPhotoSnapshot
@end
static char kSnapshotKey, kPreviewImageKey, kPreviewBufferKey;

static VCCPhotoSnapshot *snapshotForPhoto(id photo) {
    @synchronized (photo) {
        id existing = objc_getAssociatedObject(photo, &kSnapshotKey);
        if (existing) return existing == [NSNull null] ? nil : existing;
        CGImageRef frame = [[NovaMJPEG shared] copyLatestImage];
        VCCPhotoSnapshot *snapshot = nil;
        if (frame) {
            snapshot = [VCCPhotoSnapshot new];
            snapshot.image = (__bridge id)frame;
            CGImageRelease(frame);
        }
        objc_setAssociatedObject(photo, &kSnapshotKey, snapshot ?: [NSNull null], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        return snapshot;
    }
}

%hook AVCapturePhoto
- (NSData *)fileDataRepresentation {
    NSData *orig = %orig;
    if (!orig) return orig;
    @synchronized (self) {
        VCCPhotoSnapshot *snapshot = snapshotForPhoto(self);
        if (!snapshot) return orig;
        if (!snapshot.attempted) {
            snapshot.attempted = YES;
            snapshot.data = renderOBSPhotoData(orig, (__bridge CGImageRef)snapshot.image);
            snapshot.failed = !snapshot.data;
            if (snapshot.failed) {
                objc_setAssociatedObject(self, &kPreviewImageKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                objc_setAssociatedObject(self, &kPreviewBufferKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                vclog(@"foto: exportação falhou; preservando arquivo original, sem fallback JPEG");
            }
        }
        return snapshot.data ?: orig;
    }
}

- (CGImageRef)previewCGImageRepresentation {
    CGImageRef orig = %orig;
    if (!orig) return orig;
    @synchronized (self) {
        VCCPhotoSnapshot *snapshot = snapshotForPhoto(self);
        if (!snapshot || snapshot.failed) return orig;
        id cached = objc_getAssociatedObject(self, &kPreviewImageKey);
        if (cached) return (__bridge CGImageRef)cached;
        CGImageRef img = copyOBSSensorImage((__bridge CGImageRef)snapshot.image,
            CGImageGetWidth(orig), CGImageGetHeight(orig), orientationFrom(self.metadata), CGImageGetColorSpace(orig));
        if (!img) return orig;
        objc_setAssociatedObject(self, &kPreviewImageKey, (__bridge id)img, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        CGImageRelease(img);
        return (__bridge CGImageRef)objc_getAssociatedObject(self, &kPreviewImageKey);
    }
}

- (CVPixelBufferRef)previewPixelBuffer {
    CVPixelBufferRef orig = %orig;
    if (!orig) return orig;
    @synchronized (self) {
        VCCPhotoSnapshot *snapshot = snapshotForPhoto(self);
        if (!snapshot || snapshot.failed) return orig;
        id cached = objc_getAssociatedObject(self, &kPreviewBufferKey);
        if (cached) return (__bridge CVPixelBufferRef)cached;
        size_t w = CVPixelBufferGetWidth(orig), h = CVPixelBufferGetHeight(orig);
        ensureCI();
        NSDictionary *attachments = CFBridgingRelease(CVBufferCopyAttachments(orig, kCVAttachmentMode_ShouldPropagate));
        CGColorSpaceRef attachedSpace = (__bridge CGColorSpaceRef)attachments[(id)kCVImageBufferCGColorSpaceKey];
        CGColorSpaceRef space = attachedSpace ? CGColorSpaceRetain(attachedSpace)
            : (attachments ? CVImageBufferCreateColorSpaceFromAttachments((__bridge CFDictionaryRef)attachments) : NULL);
        if (!space) return orig;
        CGImageRef img = copyOBSSensorImage((__bridge CGImageRef)snapshot.image, w, h, orientationFrom(self.metadata), space);
        if (!img) { CGColorSpaceRelease(space); return orig; }
        CVPixelBufferRef buf = NULL;
        CVReturn status = CVPixelBufferCreate(kCFAllocatorDefault, w, h, CVPixelBufferGetPixelFormatType(orig),
            (__bridge CFDictionaryRef)@{(id)kCVPixelBufferIOSurfacePropertiesKey: @{}}, &buf);
        if (status != kCVReturnSuccess || !buf) { CGImageRelease(img); CGColorSpaceRelease(space); return orig; }
        // Color attachments must describe the actual conversion performed above.
        for (id key in @[(id)kCVImageBufferColorPrimariesKey, (id)kCVImageBufferTransferFunctionKey,
                         (id)kCVImageBufferYCbCrMatrixKey, (id)kCVImageBufferGammaLevelKey, (id)kCVImageBufferICCProfileKey]) {
            id value = attachments[key];
            if (value) CVBufferSetAttachment(buf, (__bridge CFStringRef)key, (__bridge CFTypeRef)value, kCVAttachmentMode_ShouldPropagate);
        }
        CVBufferSetAttachment(buf, kCVImageBufferCGColorSpaceKey, space, kCVAttachmentMode_ShouldPropagate);
        [g_ci render:[CIImage imageWithCGImage:img] toCVPixelBuffer:buf bounds:CGRectMake(0, 0, w, h) colorSpace:space];
        CGImageRelease(img);
        CGColorSpaceRelease(space);
        objc_setAssociatedObject(self, &kPreviewBufferKey, (__bridge id)buf, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        CVPixelBufferRelease(buf);
        return (__bridge CVPixelBufferRef)objc_getAssociatedObject(self, &kPreviewBufferKey);
    }
}
%end


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
