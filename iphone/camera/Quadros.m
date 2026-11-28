#import "Ponte.h"

unsigned long g_emittedVideo;
unsigned long g_emittedStill;
unsigned long g_fetchFailures;
unsigned long g_emittedRecord;
unsigned long g_photoSyntheticCompletions;
void (*g_originalPhysicalEmitSequence)(id, SEL, long long);

static BOOL VCPFormatSupported(OSType fmt) {
    return fmt == kCVPixelFormatType_32BGRA || fmt == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange ||
           fmt == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
}

static void VCPDrawFrame(CGImageRef frame, CIContext *context, CVPixelBufferRef out,
                         size_t w, size_t h, CGColorSpaceRef space, int rotation) {
    OSType fmt = out ? CVPixelBufferGetPixelFormatType(out) : 0;
    if (!frame || !context || !space || !VCPFormatSupported(fmt) || w < 2 || h < 2 ||
        w > 8192 || h > 8192 || (fmt != kCVPixelFormatType_32BGRA && ((w % 2) || (h % 2)))) return;
    if (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270) return;
    CIImage *image = [CIImage imageWithCGImage:frame];
    CGImagePropertyOrientation orientation = rotation == 90 ? kCGImagePropertyOrientationRight :
        rotation == 180 ? kCGImagePropertyOrientationDown : rotation == 270 ? kCGImagePropertyOrientationLeft : kCGImagePropertyOrientationUp;
    image = [image imageByApplyingCGOrientation:orientation];
    CGRect e = image.extent;
    image = [image imageByApplyingTransform:CGAffineTransformMakeTranslation(-e.origin.x, -e.origin.y)];
    CGFloat scale = MAX(w / e.size.width, h / e.size.height);
    image = [image imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
    e = image.extent;
    image = [image imageByApplyingTransform:CGAffineTransformMakeTranslation((w-e.size.width)/2-e.origin.x, (h-e.size.height)/2-e.origin.y)];
    [context render:image toCVPixelBuffer:out bounds:CGRectMake(0, 0, w, h) colorSpace:space];
}

static CGImageRef imageFromJPEG(NSData *data) {
    if (data.length < 4 || data.length > 2*1024*1024) return NULL;
    const uint8_t *bytes = data.bytes;
    if (bytes[0] != 0xff || bytes[1] != 0xd8) return NULL;
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    CGImageRef image = source ? CGImageSourceCreateImageAtIndex(source, 0, NULL) : NULL;
    if (source) CFRelease(source);
    if (image && (CGImageGetWidth(image) > 4096 || CGImageGetHeight(image) > 4096)) {
        CGImageRelease(image); return NULL;
    }
    return image;
}

static CGImageRef copyFrame(NSString *address, NSString *socketPath, NSURLSession *session) {
    if (socketPath.length) {
        NSURL *url = [NSURL URLWithString:address];
        NSData *data = httpGetOverUnix(socketPath, url.path, 2, 2*1024*1024);
        return imageFromJPEG(data);
    }
    dispatch_semaphore_t signal = dispatch_semaphore_create(0);
    __block NSData *data = nil;
    __block NSHTTPURLResponse *response = nil;
    NSURLSessionDataTask *task = [session dataTaskWithURL:[NSURL URLWithString:address]
        completionHandler:^(NSData *bytes, NSURLResponse *reply, NSError *error) {
            if (!error) { data = bytes; response = (NSHTTPURLResponse *)reply; }
            dispatch_semaphore_signal(signal);
        }];
    [task resume];
    if (dispatch_semaphore_wait(signal, dispatch_time(DISPATCH_TIME_NOW, 3*NSEC_PER_SEC)) != 0) {
        [task cancel]; return NULL;
    }
    if (response.statusCode != 200) return NULL;
    return imageFromJPEG(data);
}

static CMSampleBufferRef copySample(CGImageRef image, CIContext *render, CGColorSpaceRef space,
                                    size_t width, size_t height, NSString *port, CMTime pts, BOOL master, int fps, OSType pixelFormat,
                                    int rotation) {
    if (!image || !render || !space) return NULL;
    NSDictionary *attachments = @{
        (id)kCVImageBufferColorPrimariesKey:(id)kCVImageBufferColorPrimaries_P3_D65,
        (id)kCVImageBufferTransferFunctionKey:(id)kCVImageBufferTransferFunction_ITU_R_709_2,
        (id)kCVImageBufferYCbCrMatrixKey:(id)kCVImageBufferYCbCrMatrix_ITU_R_601_4,
        (id)kCVImageBufferCGColorSpaceKey:(__bridge id)space
    };
    NSDictionary *allocation = @{
        (id)kCVPixelBufferIOSurfacePropertiesKey:@{},
        (id)kCVPixelBufferBytesPerRowAlignmentKey:@64,
        (id)kCVPixelBufferPlaneAlignmentKey:@128
    };
    CVPixelBufferRef pixels = NULL;
    if (CVPixelBufferCreate(NULL, width, height, pixelFormat,
        (__bridge CFDictionaryRef)allocation, &pixels) != kCVReturnSuccess || !pixels) return NULL;
    CVBufferSetAttachments(pixels, (__bridge CFDictionaryRef)attachments, kCVAttachmentMode_ShouldPropagate);
    VCPDrawFrame(image, render, pixels, width, height, space, rotation);
    CMVideoFormatDescriptionRef format = NULL;
    CMSampleBufferRef sample = NULL;
    if (CMVideoFormatDescriptionCreateForImageBuffer(NULL, pixels, &format) == noErr) {
        CMSampleTimingInfo timing = {CMTimeMake(1, fps), pts, kCMTimeInvalid};
        if (CMSampleBufferCreateReadyWithImageBuffer(NULL, pixels, format, &timing, &sample) == noErr) {
            CMSetAttachment(sample, CFSTR("MetadataDictionary"),
                            (__bridge CFTypeRef)[@{@"PortType":port,
                                @"SynchronizedStreamsIsMaster":@(master)} mutableCopy],
                            kCMAttachmentMode_ShouldPropagate);
            CMSetAttachment(sample, CFSTR("LastPortType"), CFSTR("PortTypeBack"),
                            kCMAttachmentMode_ShouldPropagate);
        }
    }
    if (format) CFRelease(format);
    CVPixelBufferRelease(pixels);
    return sample;
}

static void emitStillSequence(OBSBridgeContext *ctx);
static void produce(OBSBridgeContext *ctx) {
    @autoreleasepool {
        static unsigned tick;
        unsigned thisTick = ++tick % 5;
        [g_lock lock];
        BOOL active = ctx.running && leaseValid();
        BOOL previewOnly = g_previewOnly;
        id requestedPhotoSettings = ctx.pendingPhotoSettings;
        id requestedPhotoStream = ctx.pendingPhotoStream;
        [g_lock unlock];
        if (!active || !ctx.masterSource) return;
        [g_lock lock];
        NSUInteger videoWidth = ctx.videoWidth, videoHeight = ctx.videoHeight;
        BOOL hasStillSource = ctx.stillSource != nil;
        [g_lock unlock];
        if (!videoWidth) { videoWidth = 1584; videoHeight = 1188; }
        if (!previewOnly && thisTick == 1 && hasStillSource) emitStillSequence(ctx);
        CGImageRef image = copyFrame(ctx.url, ctx.socket, ctx.networkSession);
        if (!image) { __atomic_add_fetch(&g_fetchFailures, 1, __ATOMIC_RELAXED); return; }
        CGColorSpaceRef space = (__bridge CGColorSpaceRef)ctx.colorSpace;
        CMTime pts = CMClockGetTime(CMClockGetHostTimeClock());
        CMSampleBufferRef video = copySample(image, ctx.renderContext, space, videoWidth, videoHeight, @"OBSBridgeVideo", pts, ctx.masterSource, ctx.frameRate, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, 270);
        BOOL produceStill = hasStillSource && (!previewOnly || requestedPhotoSettings != nil);
        CMSampleBufferRef still = produceStill ? copySample(image, ctx.renderContext, space, 4032, 3024,
            @"OBSBridgeStill", pts, ctx.masterSource, ctx.frameRate,
            kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, 270) : NULL;
        if (still && requestedPhotoSettings)
            CMSetAttachment(still, CFSTR("BWStillImageCaptureSettings"),
                (__bridge CFTypeRef)requestedPhotoSettings, kCMAttachmentMode_ShouldPropagate);
        id compressor = ctx.recordCompressor;
        id compressorInput = ctx.recordInput;
        CMSampleBufferRef record = (ctx.recordSource || (g_videoInjection && compressor && compressorInput))
            ? copySample(image, ctx.renderContext, space, 1920, 1080,
                ctx.recordSource ? @"OBSBridgeRecord" : @"Back", pts, YES, ctx.frameRate,
                kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, 270) : NULL;
        CGImageRelease(image);
        [g_lock lock]; active = ctx.running && leaseValid(); [g_lock unlock];
        if (active && video) {
            ((void (*)(id, SEL, CMSampleBufferRef))objc_msgSend)(ctx.videoSource, sel_registerName("processBuffer:"), video);
            __atomic_add_fetch(&g_emittedVideo, 1, __ATOMIC_RELAXED);
        }
        if (active && still) {
            if (requestedPhotoSettings) emitStillSequence(ctx);
            ((void (*)(id, SEL, CMSampleBufferRef))objc_msgSend)(ctx.stillSource, sel_registerName("processBuffer:"), still);
            __atomic_add_fetch(&g_emittedStill, 1, __ATOMIC_RELAXED);
            if (requestedPhotoSettings) {
                [g_lock lock];
                if (ctx.pendingPhotoSettings == requestedPhotoSettings) {
                    ctx.pendingPhotoSettings = nil;
                    ctx.pendingPhotoStream = nil;
                }
                [g_lock unlock];
                if (requestedPhotoStream) {
                    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_MSEC * 100),
                        g_controlQueue, ^{
                            id delegate = getObject(requestedPhotoStream, "stillImageCaptureDelegate");
                            if (hasABI(object_getClass(delegate),
                                "captureStreamDidCompleteStillImageCapture:", "v24@0:8@16")) {
                                ((void (*)(id, SEL, id))objc_msgSend)(delegate,
                                    sel_registerName("captureStreamDidCompleteStillImageCapture:"),
                                    requestedPhotoStream);
                                __atomic_add_fetch(&g_photoSyntheticCompletions, 1, __ATOMIC_RELAXED);
                            }
                        });
                }
            }
        }
        if (active && record) {
            if (ctx.recordSource)
                ((void (*)(id, SEL, CMSampleBufferRef))objc_msgSend)(ctx.recordSource, sel_registerName("processBuffer:"), record);
            else if (g_videoInjection && compressor && compressorInput)
                ((void (*)(id, SEL, CMSampleBufferRef, id))objc_msgSend)(compressor,
                    sel_registerName("renderSampleBuffer:forInput:"), record, compressorInput);
            __atomic_add_fetch(&g_emittedRecord, 1, __ATOMIC_RELAXED);
        }
        if (video) CFRelease(video);
        if (still) CFRelease(still);
        if (record) CFRelease(record);
    }
}

static void emitStillSequence(OBSBridgeContext *ctx) {
    static long long sequence;
    if (!g_originalPhysicalEmitSequence || !ctx.stillSource) return;
    id output = ((id (*)(id, SEL, id))objc_msgSend)(ctx.stillSource,
        sel_registerName("outputForPortType:"), @"OBSBridgeStill");
    if (!output) return;
    sequence += 1;
    g_originalPhysicalEmitSequence(output, sel_registerName(
        "emitStillImageReferenceFrameBracketedCaptureSequenceNumberMessageWithSequenceNumber:"), sequence);
}

void startProducer(OBSBridgeContext *ctx) {
    [g_lock lock];
    BOOL cameraGraph = [getObject(ctx.graph, "applicationID") isEqual:kCameraApp];
    BOOL ready = ctx.videoConnected &&
        (!cameraGraph || (ctx.stillConnected && ctx.metadataConnected));
    if (ctx.running || !leaseValid() || !ready) {
        [g_lock unlock]; return;
    }
    ctx.running = YES;
    ctx.url = g_url;
    ctx.socket = g_socket;
    ctx.frameRate = g_frameRate;
    NSURLSessionConfiguration *network = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    network.timeoutIntervalForRequest = 2;
    network.timeoutIntervalForResource = 2;
    network.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    ctx.networkSession = [NSURLSession sessionWithConfiguration:network];
    ctx.worker = dispatch_queue_create("com.aquiles.obsgraphbridge.frames", DISPATCH_QUEUE_SERIAL);
    ctx.renderContext = [CIContext contextWithOptions:@{}];
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceDisplayP3);
    ctx.colorSpace = (__bridge_transfer id)space;
    ctx.timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, ctx.worker);
    dispatch_source_set_timer(ctx.timer, DISPATCH_TIME_NOW, NSEC_PER_SEC/ctx.frameRate, NSEC_PER_MSEC);
    dispatch_source_set_event_handler(ctx.timer, ^{ produce(ctx); });
    dispatch_resume(ctx.timer);
    [g_lock unlock];
}
