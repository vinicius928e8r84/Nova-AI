#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <substrate.h>
#import "Pipeline.h"

// Experimental graph replacement for the native Camera only. A short lease
// is required before any graph is changed. A failed OBS request emits nothing.
static NSString *const kControl = @"/var/tmp/obs-graph-bridge-control.json";
static NSString *const kStatus = @"/var/tmp/obs-graph-bridge-status.json";
static NSString *const kCameraApp = @"com.apple.camera";
static Class g_physicalClass;
static Class g_softwareSourceClass;
static NSRecursiveLock *g_lock;
static NSMutableDictionary<NSValue *, id> *g_contexts;
static NSMutableSet<NSValue *> *g_redirectedGraphs;
static NSMutableSet<NSString *> *g_graphClasses;
static dispatch_queue_t g_controlQueue;
static dispatch_source_t g_statusTimer;
static BOOL g_hooksReady, g_hookAttempted, g_faulted, g_enabled;
static BOOL g_previewOnly;
static BOOL g_continuous;
static BOOL g_directRecording;
static BOOL g_videoInjection;
static BOOL g_photoPrepareBypass;
static int g_frameRate = 5;
static NSTimeInterval g_expires;
static NSString *g_url;
static unsigned long g_redirected, g_suppressedStarts, g_emittedVideo, g_emittedStill, g_fetchFailures;
static unsigned long g_graphStarts, g_graphStartFailures, g_graphStops, g_contextLimitHits;
static unsigned long g_startHookDispatchMisses;
static unsigned long g_graphCommits, g_graphCommitFailures;
static unsigned long g_connectionsResumed;
static unsigned long g_recordConnections, g_emittedRecord;
static unsigned long g_compressorImageSamples, g_compressorControlSamples;
static void (*g_originalCompressorRender)(id, SEL, CMSampleBufferRef, id);
static unsigned long g_minimumBufferBudgets;
static unsigned long g_photoPrepareBypasses;
static unsigned long g_photoStillRequests;
static unsigned long g_photoPortRemaps;
static unsigned long g_photoTimeMachineHandles;
static unsigned long g_photoTimeMachineOutputEmits;
static unsigned long g_photoTimeMachineCompleteChecks;
static unsigned long g_photoTimeMachineCompleteTrue;
static unsigned long g_photoTimeMachineConnectionsResumed;
static unsigned long g_photoCoordinatorRenders;
static unsigned long g_photoSyntheticWillCaptures;
static unsigned long g_photoSyntheticCompletions;
static unsigned long g_photoCoordinatorOutputEmits;
static unsigned long g_photoGNRBypasses;
static NSDictionary *g_lastPhotoStreamSettings;
static NSDictionary *g_lastTimeMachineFrame;
static NSDictionary *g_lastCoordinatorState;
static NSDictionary *g_lastGNRFrame;
static NSMutableArray *g_photoRoute;
static void (*g_originalInitialSemaphore)(id, SEL, int32_t);
static void (*g_originalDevicePrepare)(id, SEL, id);
static void (*g_originalStreamPrepareStill)(id, SEL, id);
static void (*g_originalTimeMachineRender)(id, SEL, CMSampleBufferRef, id);
static void (*g_originalTimeMachineHandle)(id, SEL, CMSampleBufferRef);
static BOOL (*g_originalTimeMachineComplete)(id, SEL);
static void (*g_originalOutputEmit)(id, SEL, CMSampleBufferRef);
static void (*g_originalCoordinatorRender)(id, SEL, CMSampleBufferRef, id);
static void (*g_originalGNRRender)(id, SEL, CMSampleBufferRef, id);
static NSString *g_lastCommitError;
static BOOL (*g_originalConnect)(id, SEL, id, id, id);
static BOOL (*g_originalPhysicalStart)(id, SEL, void *);
static BOOL (*g_originalPhysicalStop)(id, SEL, void *);
static BOOL (*g_originalPhysicalPools)(id, SEL, id);
static id (*g_originalPhysicalClock)(id, SEL);
static void (*g_originalPhysicalEmitSequence)(id, SEL, long long);
static BOOL (*g_originalGraphStart)(id, SEL, void *);
static void (*g_originalDeferredStart)(id, SEL);
static void (*g_originalDeferredPrepare)(id, SEL, id);
static BOOL (*g_originalGraphStop)(id, SEL, void *);
static BOOL (*g_originalGraphCommit)(id, SEL, long long, id *);
static BOOL bridgeGraphStart(id graph, SEL selector, void *error);

@interface OBSBridgeContext : NSObject
@property (nonatomic, strong) id graph;
@property (nonatomic, strong) id physical;
@property (nonatomic, strong) id videoSource;
@property (nonatomic, strong) id stillSource;
@property (nonatomic, strong) id recordSource;
@property (nonatomic, strong) id recordCompressor;
@property (nonatomic, strong) id recordInput;
@property (nonatomic, strong) id recordFunnel;
@property (nonatomic, strong) NSArray *recordInputs;
@property (nonatomic, strong) id metadataSource;
@property (nonatomic, copy) NSString *url;
@property (nonatomic, strong) CIContext *renderContext;
@property (nonatomic, strong) id colorSpace;
@property (nonatomic, strong) dispatch_queue_t worker;
@property (nonatomic, strong) dispatch_source_t timer;
@property BOOL videoConnected;
@property BOOL stillConnected;
@property BOOL metadataConnected;
@property BOOL running;
@property BOOL masterSource;
@property int frameRate;
@property (nonatomic, strong) NSURLSession *networkSession;
@property (nonatomic, strong) id pendingPhotoSettings;
@property (nonatomic, strong) id pendingPhotoStream;
@end
@implementation OBSBridgeContext
@end

static BOOL hasABI(Class cls, const char *name, const char *expected) {
    Method method = cls ? class_getInstanceMethod(cls, sel_registerName(name)) : NULL;
    return method && !strcmp(method_getTypeEncoding(method), expected);
}

static id getObject(id object, const char *name) {
    if (!object) return nil;
    SEL selector = sel_registerName(name);
    Method method = class_getInstanceMethod(object_getClass(object), selector);
    if (!method || method_getNumberOfArguments(method) != 2) return nil;
    char type[8] = {0}; method_getReturnType(method, type, sizeof(type));
    if (type[0] != '@') return nil;
    @try { return ((id (*)(id, SEL))objc_msgSend)(object, selector); }
    @catch (NSException *exception) { return nil; }
}

static id numericGetter(id object, const char *name) {
    Method method = object ? class_getInstanceMethod(object_getClass(object), sel_registerName(name)) : NULL;
    if (!method || method_getNumberOfArguments(method) != 2) return [NSNull null];
    char type[8] = {0}; method_getReturnType(method, type, sizeof(type));
    if (type[0] == 'i' || type[0] == 'I')
        return @(((int (*)(id, SEL))objc_msgSend)(object, sel_registerName(name)));
    if (type[0] == 'q' || type[0] == 'Q')
        return @(((long long (*)(id, SEL))objc_msgSend)(object, sel_registerName(name)));
    return [NSNull null];
}

static id ivarObject(id object, const char *name) {
    Ivar ivar = object ? class_getInstanceVariable(object_getClass(object), name) : NULL;
    if (!ivar || ivar_getTypeEncoding(ivar)[0] != '@') return nil;
    return object_getIvar(object, ivar);
}

static id ivarNumber(id object, const char *name) {
    Ivar ivar = object ? class_getInstanceVariable(object_getClass(object), name) : NULL;
    if (!ivar) return [NSNull null];
    const char *type = ivar_getTypeEncoding(ivar);
    const uint8_t *location = (const uint8_t *)(__bridge const void *)object + ivar_getOffset(ivar);
    if (type[0] == 'B') return @(*location != 0);
    if (type[0] == 'i' || type[0] == 'I') {
        int32_t value;
        memcpy(&value, location, sizeof(value));
        return @(value);
    }
    return [NSNull null];
}

static NSString *roleForOutput(id physical, id output) {
    if (getObject(physical, "videoCaptureOutput") == output) return @"video";
    if (getObject(physical, "stillImageOutput") == output) return @"still";
    if (getObject(physical, "detectedObjectsOutput") == output) return @"metadata";
    return nil;
}

static BOOL leaseValid(void) {
    return g_enabled && !g_faulted && (g_continuous || [[NSDate date] timeIntervalSince1970] < g_expires);
}

static void readControl(void) {
    NSData *data = [NSData dataWithContentsOfFile:kControl];
    id parsed = data.length > 0 && data.length <= 2048
        ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    NSDictionary *config = [parsed isKindOfClass:[NSDictionary class]] ? parsed : nil;
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    id expiry = [config isKindOfClass:[NSDictionary class]] ? config[@"expiresAt"] : nil;
    id address = [config isKindOfClass:[NSDictionary class]] ? config[@"url"] : nil;
    NSURL *url = [address isKindOfClass:[NSString class]] ? [NSURL URLWithString:address] : nil;
    BOOL continuous = [config[@"continuous"] isEqual:@YES];
    BOOL valid = [config[@"mode"] isEqual:@"inject"] && [config[@"appID"] isEqual:kCameraApp] &&
        [expiry isKindOfClass:[NSNumber class]] && [url.scheme isEqualToString:@"http"] &&
        (([url.host isEqualToString:@"10.0.0.245"] && [url.port integerValue] == 8900) ||
         ([url.host isEqualToString:@"127.0.0.1"] && [url.port integerValue] == 18999)) &&
        [url.path isEqualToString:@"/frame.jpg"] &&
        (continuous || ([expiry doubleValue] > now && [expiry doubleValue] <= now+120));
    [g_lock lock];
    g_enabled = valid;
    g_continuous = valid && continuous;
    g_directRecording = valid && [config[@"directRecording"] isEqual:@YES];
    g_videoInjection = valid && [config[@"videoInjection"] isEqual:@YES];
    g_photoPrepareBypass = valid && [config[@"photoPrepareBypass"] isEqual:@YES];
    if (!g_photoPrepareBypass)
        for (OBSBridgeContext *ctx in g_contexts.allValues) {
            ctx.pendingPhotoSettings = nil;
            ctx.pendingPhotoStream = nil;
        }
    id rate = config[@"frameRate"];
    g_frameRate = [rate isKindOfClass:[NSNumber class]] ? MAX(1, MIN(30, [rate intValue])) : 5;
    g_previewOnly = valid && [config[@"previewOnly"] isEqual:@YES];
    g_expires = valid ? [expiry doubleValue] : 0;
    g_url = valid ? [address copy] : nil;
    [g_lock unlock];
}

static void saveStatus(void) {
    [g_lock lock];
    NSMutableArray *sessions = [NSMutableArray array];
    for (OBSBridgeContext *ctx in g_contexts.allValues) {
        if (sessions.count >= 4) break;
        [sessions addObject:@{@"video":@(ctx.videoConnected), @"still":@(ctx.stillConnected),
                              @"metadata":@(ctx.metadataConnected), @"running":@(ctx.running && leaseValid()),
                              @"master":@(ctx.masterSource), @"targetFPS":@(ctx.frameRate),
                              @"recordInputKnown":@(ctx.recordInput != nil)}];
    }
    NSDictionary *status = @{
        @"version":@"0.1-30", @"pid":@([NSProcessInfo processInfo].processIdentifier),
        @"directRecording":@(g_directRecording), @"recordConnections":@(g_recordConnections),
        @"videoInjection":@(g_videoInjection), @"compressorImageSamples":@(g_compressorImageSamples),
        @"compressorControlSamples":@(g_compressorControlSamples),
        @"photoPrepareBypass":@(g_photoPrepareBypass), @"photoPrepareBypasses":@(g_photoPrepareBypasses),
        @"photoPrepareHookReady":@(g_originalDevicePrepare != NULL),
        @"photoStillHookReady":@(g_originalStreamPrepareStill != NULL),
        @"photoStillRequests":@(g_photoStillRequests),
        @"photoPortRemapHookReady":@(g_originalTimeMachineRender != NULL),
        @"photoPortRemaps":@(g_photoPortRemaps),
        @"lastPhotoStreamSettings":g_lastPhotoStreamSettings ?: @{},
        @"lastTimeMachineFrame":g_lastTimeMachineFrame ?: @{},
        @"photoTimeMachineHandleHookReady":@(g_originalTimeMachineHandle != NULL),
        @"photoTimeMachineHandles":@(g_photoTimeMachineHandles),
        @"photoTimeMachineOutputEmits":@(g_photoTimeMachineOutputEmits),
        @"photoTimeMachineCompleteChecks":@(g_photoTimeMachineCompleteChecks),
        @"photoTimeMachineCompleteTrue":@(g_photoTimeMachineCompleteTrue),
        @"photoTimeMachineConnectionsResumed":@(g_photoTimeMachineConnectionsResumed),
        @"photoCoordinatorRenderHookReady":@(g_originalCoordinatorRender != NULL),
        @"photoCoordinatorRenders":@(g_photoCoordinatorRenders),
        @"photoSyntheticWillCaptures":@(g_photoSyntheticWillCaptures),
        @"photoSyntheticCompletions":@(g_photoSyntheticCompletions),
        @"photoCoordinatorOutputEmits":@(g_photoCoordinatorOutputEmits),
        @"lastCoordinatorState":g_lastCoordinatorState ?: @{},
        @"photoRoute":g_photoRoute ?: @[],
        @"photoGNRHookReady":@(g_originalGNRRender != NULL),
        @"photoGNRBypasses":@(g_photoGNRBypasses),
        @"lastGNRFrame":g_lastGNRFrame ?: @{},
        @"emittedRecord":@(g_emittedRecord),
        @"minimumBufferBudgets":@(g_minimumBufferBudgets),
        @"continuous":@(g_continuous), @"targetFPS":@(g_frameRate),
        @"previewOnly":@(g_previewOnly),
        @"timestamp":@([[NSDate date] timeIntervalSince1970]),
        @"hooksReady":@(g_hooksReady), @"enabled":@(leaseValid()), @"faulted":@(g_faulted),
        @"expiresAt":@(g_expires), @"sessions":sessions,
        @"redirected":@(g_redirected), @"suppressedStarts":@(g_suppressedStarts),
        @"emittedVideo":@(g_emittedVideo), @"emittedStill":@(g_emittedStill),
        @"fetchFailures":@(g_fetchFailures), @"graphStarts":@(g_graphStarts),
        @"graphStartFailures":@(g_graphStartFailures), @"graphStops":@(g_graphStops),
        @"contextLimitHits":@(g_contextLimitHits), @"contextCount":@(g_contexts.count),
        @"graphClasses":g_graphClasses.allObjects, @"startHookDispatchMisses":@(g_startHookDispatchMisses),
        @"graphCommits":@(g_graphCommits), @"graphCommitFailures":@(g_graphCommitFailures),
        @"connectionsResumed":@(g_connectionsResumed),
        @"lastCommitError":g_lastCommitError ?: @""
    };
    [g_lock unlock];
    NSData *json = [NSJSONSerialization dataWithJSONObject:status options:NSJSONWritingPrettyPrinted error:nil];
    [json writeToFile:kStatus options:NSDataWritingAtomic error:nil];
}

static CGImageRef copyFrame(NSString *address, NSURLSession *session) {
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
    if (response.statusCode != 200 || data.length < 4 || data.length > 2*1024*1024) return NULL;
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

static CMSampleBufferRef copySample(CGImageRef image, CIContext *render, CGColorSpaceRef space,
                                    size_t width, size_t height, NSString *port, CMTime pts, BOOL master, int fps, OSType pixelFormat) {
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
    VCPDrawFrame(image, render, pixels, width, height, space, 0);
    CMVideoFormatDescriptionRef format = NULL;
    CMSampleBufferRef sample = NULL;
    if (CMVideoFormatDescriptionCreateForImageBuffer(NULL, pixels, &format) == noErr) {
        CMSampleTimingInfo timing = {CMTimeMake(1, fps), pts, kCMTimeInvalid};
        if (CMSampleBufferCreateReadyWithImageBuffer(NULL, pixels, format, &timing, &sample) == noErr) {
            CMSetAttachment(sample, CFSTR("MetadataDictionary"),
                            // BWVideoCompressorNode writes timing into this dictionary.
                            // An immutable literal raises at setObject:forKeyedSubscript:.
                            (__bridge CFTypeRef)[@{@"PortType":port,
                                @"SynchronizedStreamsIsMaster":@(master)} mutableCopy],
                            kCMAttachmentMode_ShouldPropagate);
            // The MOV sink uses this top-level attachment as an analytics
            // dictionary key. Missing it raises an exception (nil key).
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
        if (!previewOnly && thisTick == 1) emitStillSequence(ctx);
        CGImageRef image = copyFrame(ctx.url, ctx.networkSession);
        if (!image) { __atomic_add_fetch(&g_fetchFailures, 1, __ATOMIC_RELAXED); return; }
        CGColorSpaceRef space = (__bridge CGColorSpaceRef)ctx.colorSpace;
        CMTime pts = CMClockGetTime(CMClockGetHostTimeClock());
        CMSampleBufferRef video = copySample(image, ctx.renderContext, space, 1584, 1188, @"OBSBridgeVideo", pts, ctx.masterSource, ctx.frameRate, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange);
        BOOL produceStill = !previewOnly || requestedPhotoSettings != nil;
        CMSampleBufferRef still = produceStill ? copySample(image, ctx.renderContext, space, 4032, 3024,
            @"OBSBridgeStill", pts, ctx.masterSource, ctx.frameRate,
            kCVPixelFormatType_420YpCbCr8BiPlanarFullRange) : NULL;
        if (still && requestedPhotoSettings)
            CMSetAttachment(still, CFSTR("BWStillImageCaptureSettings"),
                (__bridge CFTypeRef)requestedPhotoSettings, kCMAttachmentMode_ShouldPropagate);
        id compressor = ctx.recordCompressor;
        id compressorInput = ctx.recordInput;
        CMSampleBufferRef record = (ctx.recordSource || (g_videoInjection && compressor && compressorInput))
            ? copySample(image, ctx.renderContext, space, 1920, 1080,
                ctx.recordSource ? @"OBSBridgeRecord" : @"Back", pts, YES, ctx.frameRate,
                kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange) : NULL;
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

// The Synchronizer→VideoCompressor→RemoteQueue path (the client-facing
// viewfinder transport) only runs once the graph has a master clock; the
// never-started physical node would provide it, so give redirected nodes the
// host clock — the same domain used by our software sources' timestamps.
static id physicalClockOverride(id node, SEL selector) {
    [g_lock lock];
    BOOL mapped = g_contexts[[NSValue valueWithPointer:(__bridge const void *)node]] != nil;
    [g_lock unlock];
    if (mapped) return (__bridge id)CMClockGetHostTimeClock();
    return g_originalPhysicalClock ? g_originalPhysicalClock(node, selector) : nil;
}

// The still pipeline's coordinator gates the shutter on bracket-sequence
// messages only the physical node emits; publish them from the still output
// so the photo sink can start receiving.
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

static void resumeContextConnections(OBSBridgeContext *ctx) {
    // consumeMessage:fromOutput: only delivers on connections resumed for
    // data: suspended connections cache messages and events-only connections
    // discard sample buffers silently (observed 26/10, probe 0.1-9: 174
    // consumed, zero rendered). The session resumes the connections it
    // knows; ours is new. Resume before source start to preserve configuration events.
    Class connectionClass = objc_getClass("BWNodeConnection");
    if (connectionClass && hasABI(connectionClass, "resumeForEventsOnly:", "v20@0:8B16")) {
        id outputs[4] = {ctx.videoSource, ctx.stillSource, ctx.metadataSource, ctx.recordSource};
        const char *getters[4] = {"outputForPortType:", "outputForPortType:", "output", "outputForPortType:"};
        NSString *ports[4] = {@"OBSBridgeVideo", @"OBSBridgeStill", nil, @"OBSBridgeRecord"};
        for (int i = 0; i < 4; i++) {
            if (!outputs[i]) continue;
            id output = ports[i]
                ? ((id (*)(id, SEL, id))objc_msgSend)(outputs[i], sel_registerName(getters[i]), ports[i])
                : getObject(outputs[i], getters[i]);
            id connection = getObject(output, "connection");
            if (!connection) continue;
            ((void (*)(id, SEL, BOOL))objc_msgSend)(connection, sel_registerName("resumeForEventsOnly:"), NO);
            g_connectionsResumed++;
        }
        for (id recordInput in ctx.recordInputs) {
            id connection = getObject(recordInput, "connection");
            if (connection) {
                ((void (*)(id, SEL, BOOL))objc_msgSend)(connection, sel_registerName("resumeForEventsOnly:"), NO);
                g_connectionsResumed++;
            }
        }
    }
}

static void startProducer(OBSBridgeContext *ctx) {
    [g_lock lock];
    if (ctx.running || !leaseValid() || !ctx.videoConnected || !ctx.stillConnected || !ctx.metadataConnected) {
        [g_lock unlock]; return;
    }
    ctx.running = YES;
    ctx.url = g_url;
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

static OBSBridgeContext *contextForGraphAndPhysical(id graph, id physical) {
    NSValue *key = [NSValue valueWithPointer:(__bridge const void *)physical];
    OBSBridgeContext *ctx = g_contexts[key];
    if (!ctx) {
        // A graph construction failure can cause rapid retries. Stop before
        // keeping hundreds of graphs and software nodes alive in mediaserverd.
        if (g_contexts.count >= 4) {
            g_contextLimitHits++;
            g_faulted = YES;
            return nil;
        }
        ctx = [OBSBridgeContext new];
        ctx.graph = graph; ctx.physical = physical;
        // BWCrossoverNode only forwards samples whose metadata marks the
        // synchronized stream as master. Elect exactly one software source
        // per graph; physical front/back inputs must not both become master.
        ctx.masterSource = YES;
        for (OBSBridgeContext *existing in g_contexts.allValues)
            if (existing.graph == graph) { ctx.masterSource = NO; break; }
        g_contexts[key] = ctx;
    }
    return ctx;
}

static id createVideoSourceWithFormat(id graph, NSString *port, NSUInteger width, NSUInteger height, OSType pixelFormat) {
    // The deferred source inherits BWSourceNode's clock, which returns nil;
    // the real pipeline schedules presentation against the source clock, so a
    // nil clock leaves emitted samples buffered forever (black viewfinder,
    // zero drops — observed 26/10 with probe 0.1-7). This subclass returns
    // the host clock, the same domain used to timestamp produced samples.
    if (!g_softwareSourceClass) {
        Class base = objc_getClass("BWDeferredProcessingSourceNode");
        if (!base) return nil;
        Class created = objc_allocateClassPair(base, "OBSBridgeSoftwareSource", 0);
        if (!created) return nil;
        IMP clockIMP = imp_implementationWithBlock(^id(id self) {
            return (__bridge id)CMClockGetHostTimeClock();
        });
        if (!class_addMethod(created, sel_registerName("clock"), clockIMP, "@16@0:8")) {
            objc_disposeClassPair(created);
            return nil;
        }
        objc_registerClassPair(created);
        g_softwareSourceClass = created;
    }
    NSDictionary *attrs = @{
        (id)kCVPixelBufferWidthKey:@(width), (id)kCVPixelBufferHeightKey:@(height),
        (id)kCVPixelBufferPixelFormatTypeKey:@(pixelFormat)
    };
    id node = ((id (*)(id, SEL, id, id, int))objc_msgSend)(
        ((id (*)(id, SEL))objc_msgSend)(g_softwareSourceClass, sel_registerName("alloc")),
        sel_registerName("initWithPortTypes:attributes:colorSpaceProperties:"), @[port], attrs, 3);
    id error = nil;
    if (!node || !((BOOL (*)(id, SEL, id, id *))objc_msgSend)(graph, sel_registerName("addNode:error:"), node, &error)) return nil;
    return node;
}

static id createVideoSource(id graph, NSString *port, NSUInteger width, NSUInteger height) {
    return createVideoSourceWithFormat(graph, port, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange);
}

static id createMetadataSource(id graph) {
    NSArray *identifiers = @[@"mdta/com.apple.quicktime.detected-face",
        @"mdta/com.apple.quicktime.detected-human-body", @"mdta/com.apple.quicktime.detected-cat-body",
        @"mdta/com.apple.quicktime.detected-dog-body", @"mdta/com.apple.quicktime.detected-salient-object"];
    NSMutableArray *specs = [NSMutableArray array];
    for (NSString *identifier in identifiers)
        [specs addObject:@{(id)kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier:identifier,
                           (id)kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType:(id)kCMMetadataBaseDataType_RawData}];
    CMMetadataFormatDescriptionRef format = NULL;
    if (CMMetadataFormatDescriptionCreateWithMetadataSpecifications(NULL, kCMMetadataFormatType_Boxed,
        (__bridge CFArrayRef)specs, &format) != noErr || !format) return nil;
    Class cls = objc_getClass("BWMetadataSourceNode");
    id node = ((id (*)(id, SEL, CMFormatDescriptionRef, CMClockRef))objc_msgSend)(
        ((id (*)(id, SEL))objc_msgSend)(cls, sel_registerName("alloc")),
        sel_registerName("initWithFormatDescription:clock:"), format, CMClockGetHostTimeClock());
    CFRelease(format);
    id error = nil;
    if (!node || !((BOOL (*)(id, SEL, id, id *))objc_msgSend)(graph, sel_registerName("addNode:error:"), node, &error)) return nil;
    return node;
}

static BOOL redirectedConnect(id graph, SEL selector, id output, id input, id stage) {
    @autoreleasepool {
        if (!g_originalConnect) return NO;
        NSValue *graphKey = [NSValue valueWithPointer:(__bridge const void *)graph];
        [g_lock lock];
        BOOL active = leaseValid(), previouslyRedirected = [g_redirectedGraphs containsObject:graphKey];
        BOOL requested = g_enabled && [[NSDate date] timeIntervalSince1970] < g_expires;
        [g_lock unlock];
        if (!active) {
            if (previouslyRedirected) return NO;
            id appID = requested ? getObject(graph, "applicationID") : nil;
            if ([appID isEqual:kCameraApp]) return NO;
            return g_originalConnect(graph, selector, output, input, stage);
        }
        id appID = getObject(graph, "applicationID");
        if (![appID isKindOfClass:[NSString class]] || ![appID isEqual:kCameraApp])
            return previouslyRedirected ? NO : g_originalConnect(graph, selector, output, input, stage);
        id destination = getObject(input, "node");
        if (g_directRecording && previouslyRedirected &&
            [NSStringFromClass(object_getClass(destination)) isEqual:@"BWVideoCompressorNode"]) {
            [g_lock lock];
            OBSBridgeContext *recordContext = nil;
            for (OBSBridgeContext *candidate in g_contexts.allValues)
                if (candidate.graph == graph && candidate.masterSource) { recordContext = candidate; break; }
            [g_lock unlock];
            if (!recordContext || recordContext.recordSource) return NO;
            recordContext.recordSource = createVideoSourceWithFormat(graph, @"OBSBridgeRecord", 1920, 1080,
                kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange);
            if (!recordContext.recordSource) return NO;
            id replacement = ((id (*)(id, SEL, id))objc_msgSend)(recordContext.recordSource,
                sel_registerName("outputForPortType:"), @"OBSBridgeRecord");
            // Keep the native stream's recording boundary/control messages.
            // Images alone never initialize the compressor's recording state.
            Class funnelClass = objc_getClass("BWFunnelNode");
            if (!hasABI(funnelClass, "initWithNumberOfInputs:mediaType:", "@24@0:8i16I20")) return NO;
            id funnel = ((id (*)(id, SEL, int32_t, uint32_t))objc_msgSend)(
                ((id (*)(id, SEL))objc_msgSend)(funnelClass, sel_registerName("alloc")),
                sel_registerName("initWithNumberOfInputs:mediaType:"), 2, kCMMediaType_Video);
            id error = nil;
            if (!funnel || !((BOOL (*)(id, SEL, id, id *))objc_msgSend)(graph,
                sel_registerName("addNode:error:"), funnel, &error)) return NO;
            NSArray *inputs = getObject(funnel, "inputs");
            if (![inputs isKindOfClass:[NSArray class]] || inputs.count != 2) return NO;
            recordContext.recordFunnel = funnel;
            recordContext.recordInputs = @[inputs[0], inputs[1], input];
            BOOL connected = g_originalConnect(graph, selector, output, inputs[0], stage) &&
                g_originalConnect(graph, selector, replacement, inputs[1], stage) &&
                g_originalConnect(graph, selector, getObject(funnel, "output"), input, stage);
            if (connected) { [g_lock lock]; g_recordConnections++; [g_lock unlock]; }
            return connected;
        }
        id physical = getObject(output, "node");
        if (!physical || ![physical isKindOfClass:g_physicalClass])
            return g_originalConnect(graph, selector, output, input, stage);
        [g_lock lock];
        [g_redirectedGraphs addObject:graphKey];
        if (g_graphClasses.count < 8) [g_graphClasses addObject:NSStringFromClass(object_getClass(graph))];
        if (class_getMethodImplementation(object_getClass(graph), sel_registerName("start:")) != (IMP)bridgeGraphStart)
            g_startHookDispatchMisses++;
        [g_lock unlock];
        NSString *role = roleForOutput(physical, output);
        if (!role) { [g_lock lock]; g_faulted = YES; [g_lock unlock]; return NO; }
        [g_lock lock];
        OBSBridgeContext *ctx = contextForGraphAndPhysical(graph, physical);
        [g_lock unlock];
        if (!ctx) return NO;
        id replacement = nil;
        @try {
            if ([role isEqual:@"video"]) {
                if (!ctx.videoSource) ctx.videoSource = createVideoSource(graph, @"OBSBridgeVideo", 1584, 1188);
                replacement = ((id (*)(id, SEL, id))objc_msgSend)(ctx.videoSource,
                    sel_registerName("outputForPortType:"), @"OBSBridgeVideo");
            } else if ([role isEqual:@"still"]) {
                if (!ctx.stillSource) ctx.stillSource = createVideoSource(graph, @"OBSBridgeStill", 4032, 3024);
                replacement = ((id (*)(id, SEL, id))objc_msgSend)(ctx.stillSource,
                    sel_registerName("outputForPortType:"), @"OBSBridgeStill");
            } else {
                if (!ctx.metadataSource) ctx.metadataSource = createMetadataSource(graph);
                replacement = getObject(ctx.metadataSource, "output");
            }
            if (!replacement) { [g_lock lock]; g_faulted = YES; [g_lock unlock]; return NO; }
            BOOL connected = g_originalConnect(graph, selector, replacement, input, stage);
            [g_lock lock];
            if (connected) {
                if ([role isEqual:@"video"]) ctx.videoConnected = YES;
                else if ([role isEqual:@"still"]) ctx.stillConnected = YES;
                else ctx.metadataConnected = YES;
                g_redirected++;
            } else g_faulted = YES;
            [g_lock unlock];
            return connected;
        } @catch (NSException *exception) {
            [g_lock lock]; g_faulted = YES; [g_lock unlock];
            return NO;
        }
    }
}

static BOOL suppressedPhysicalStart(id node, SEL selector, void *error) {
    [g_lock lock];
    OBSBridgeContext *ctx = g_contexts[[NSValue valueWithPointer:(__bridge const void *)node]];
    id graph = getObject(node, "graph");
    BOOL mapped = ctx != nil || [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    BOOL ready = mapped && leaseValid() && ctx.videoConnected && ctx.stillConnected && ctx.metadataConnected;
    if (mapped) g_suppressedStarts++;
    [g_lock unlock];
    if (!mapped) return g_originalPhysicalStart ? g_originalPhysicalStart(node, selector, error) : NO;
    return ready; // never start hardware for a redirected graph
}

static BOOL suppressedPhysicalStop(id node, SEL selector, void *error) {
    [g_lock lock];
    id graph = getObject(node, "graph");
    BOOL mapped = g_contexts[[NSValue valueWithPointer:(__bridge const void *)node]] != nil ||
        [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    [g_lock unlock];
    return mapped ? YES : (g_originalPhysicalStop ? g_originalPhysicalStop(node, selector, error) : NO);
}

// Diagnosed 26/10 with probe 0.1-6: with its three outputs redirected, the
// physical node's allocateOrReuseBufferPoolsFromSourceNode: returns -12780
// inside _captureSession_startGraph, which aborts the session before
// [BWGraph start:]. Those pools feed this node's buffers; a redirected node
// never starts and produces none, so report success and allocate nothing.
static int32_t suppressedPhysicalPools(id node, SEL selector, id source) {
    [g_lock lock];
    BOOL mapped = g_contexts[[NSValue valueWithPointer:(__bridge const void *)node]] != nil;
    BOOL active = leaseValid();
    [g_lock unlock];
    if (mapped && active) return 0;
    return g_originalPhysicalPools ? g_originalPhysicalPools(node, selector, source) : -12780;
}

static BOOL bridgeGraphStart(id graph, SEL selector, void *error) {
    if (!g_originalGraphStart) return NO;
    [g_lock lock];
    BOOL mapped = [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    if (mapped) g_graphStarts++;
    [g_lock unlock];
    // Sources publish configuration-live notifications during graph start.
    // Open the new connections first, including the branch that has no still
    // image samples while preview-only mode is active.
    if (mapped) {
        [g_lock lock]; NSArray *beforeStart = [g_contexts.allValues copy]; [g_lock unlock];
        for (OBSBridgeContext *ctx in beforeStart)
            if (ctx.graph == graph) resumeContextConnections(ctx);
    }
    BOOL started = g_originalGraphStart(graph, selector, error);
    if (mapped && !started) {
        [g_lock lock]; g_graphStartFailures++; [g_lock unlock];
    }
    if (started) {
        // The physical node's suppressed start normally triggers the deferred
        // prepare wave that resumes the FanOut branches (probe 0.1-11: several
        // FanOut outputs stayed suspended, starving Funnel→RemoteQueue). Run
        // the graph's own prepare machinery here instead.
        if (mapped) {
            if (g_originalDeferredStart)
                g_originalDeferredStart(graph, sel_registerName("startDeferredSourceNodesIfNeeded"));
            if (g_originalDeferredPrepare)
                g_originalDeferredPrepare(graph, sel_registerName(
                    "startDeferredNodePrepareIfNeededWithCompletionHandler:"), nil);
        }
        [g_lock lock]; NSArray *contexts = [g_contexts.allValues copy]; [g_lock unlock];
        for (OBSBridgeContext *ctx in contexts) if (ctx.graph == graph) startProducer(ctx);
    }
    return started;
}

static BOOL bridgeGraphCommit(id graph, SEL selector, long long configurationID, id *error) {
    if (!g_originalGraphCommit) return NO;
    [g_lock lock];
    BOOL mapped = [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    [g_lock unlock];
    BOOL committed = NO;
    @try {
        committed = g_originalGraphCommit(graph, selector, configurationID, error);
    } @catch (NSException *exception) {
        // Keep unrelated sessions' behavior unchanged. For redirected graphs,
        // stop injection and expose the actual contract violation instead of
        // allowing an uncaught exception to restart mediaserverd repeatedly.
        if (!mapped) @throw;
        NSString *reason = [NSString stringWithFormat:@"%@: %@", exception.name, exception.reason ?: @""];
        [g_lock lock];
        g_faulted = YES;
        g_lastCommitError = reason;
        [g_lock unlock];
        if (error) *error = [NSError errorWithDomain:@"com.aquiles.obsgraphbridge" code:1
            userInfo:@{NSLocalizedDescriptionKey:reason}];
    }
    if (mapped) {
        [g_lock lock];
        g_graphCommits++;
        if (!committed) {
            g_graphCommitFailures++;
            NSString *description = error && *error ? [*error description] :
                (g_lastCommitError.length ? g_lastCommitError : @"commit returned NO without error");
            g_lastCommitError = [[description substringToIndex:MIN(description.length, 600)] copy];
        }
        [g_lock unlock];
    }
    return committed;
}

static void bridgeInitialSemaphore(id node, SEL selector, int32_t capacity) {
    id graph = getObject(node, "graph");
    [g_lock lock];
    BOOL mapped = [g_redirectedGraphs containsObject:
        [NSValue valueWithPointer:(__bridge const void *)graph]];
    // The software source has no hardware pool budget. A zero calculated
    // budget aborts movie graph setup. Test a bounded single-buffer budget,
    // retaining the normal semaphore/back-pressure behavior downstream.
    if (mapped && capacity == 0) { capacity = 1; g_minimumBufferBudgets++; }
    [g_lock unlock];
    g_originalInitialSemaphore(node, selector, capacity);
}

static void bridgeDevicePrepare(id device, SEL selector, id completion) {
    BOOL bypass = NO;
    [g_lock lock];
    if (g_photoPrepareBypass && leaseValid() && completion) {
        Class source = g_physicalClass;
        Ivar field = source ? class_getInstanceVariable(source, "_captureDevice") : NULL;
        if (field && ivar_getOffset(field) == 96) {
            for (OBSBridgeContext *ctx in g_contexts.allValues) {
                if (ctx.running && ctx.physical && object_getIvar(ctx.physical, field) == device) {
                    bypass = YES;
                    g_photoPrepareBypasses++;
                    break;
                }
            }
        }
    }
    [g_lock unlock];
    if (!bypass) {
        g_originalDevicePrepare(device, selector, completion);
        return;
    }
    // The physical source never starts in an OBS graph, so its preparation
    // callback cannot arrive. Complete only this mapped camera request after
    // the coordinator has entered its waiting state; leave sample capture and
    // all unrelated devices untouched.
    void (^reply)(int32_t) = [completion copy];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_MSEC * 100), g_controlQueue, ^{
        reply(0);
    });
}

static void bridgeStreamPrepareStill(id stream, SEL selector, id settings) {
    g_originalStreamPrepareStill(stream, selector, settings);
    BOOL sendWillCapture = NO;
    [g_lock lock];
    if (g_photoPrepareBypass && leaseValid() && settings) {
        NSMutableArray *streams = [NSMutableArray array];
        id values = getObject(settings, "captureStreamSettings");
        if ([values isKindOfClass:[NSArray class]]) {
            for (id value in (NSArray *)values) {
                if (streams.count >= 4) break;
                [streams addObject:@{
                    @"portType":getObject(value, "portType") ?: @"<nil>",
                    @"expectedFrameCaptureCount":numericGetter(value, "expectedFrameCaptureCount"),
                    @"expectedTimeMachineFrameCaptureCount":numericGetter(value, "expectedTimeMachineFrameCaptureCount"),
                    @"timeMachineFrameCount":numericGetter(value, "timeMachineFrameCount")
                }];
            }
        }
        g_lastPhotoStreamSettings = @{
            @"settingsID":numericGetter(settings, "settingsID"),
            @"captureFlags":numericGetter(settings, "captureFlags"),
            @"captureType":numericGetter(settings, "captureType"),
            @"streams":streams
        };
    }
    if (g_photoPrepareBypass && leaseValid() && settings) {
        id graph = nil;
        for (OBSBridgeContext *ctx in g_contexts.allValues) {
            if (ctx.running && getObject(ctx.physical, "captureStream") == stream) {
                graph = ctx.graph;
                break;
            }
        }
        if (graph) {
            for (OBSBridgeContext *ctx in g_contexts.allValues) {
                if (ctx.graph == graph && ctx.masterSource && ctx.running) {
                    ctx.pendingPhotoSettings = settings;
                    ctx.pendingPhotoStream = stream;
                    g_photoStillRequests++;
                    sendWillCapture = YES;
                    break;
                }
            }
        }
    }
    [g_lock unlock];
    if (sendWillCapture && hasABI(object_getClass(stream),
        "willCaptureStillImageFromFirmware", "v16@0:8")) {
        ((void (*)(id, SEL))objc_msgSend)(stream,
            sel_registerName("willCaptureStillImageFromFirmware"));
        __atomic_add_fetch(&g_photoSyntheticWillCaptures, 1, __ATOMIC_RELAXED);
    }
}

// The software output is named OBSBridgeStill, but the original photo
// settings identify the camera port as PortTypeBack. The time-machine node
// indexes its per-port capture state using the sample's MetadataDictionary.
// Translate only our tagged still frame at this node boundary.
static void bridgeTimeMachineRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
    if (sample && CMGetAttachment(sample, CFSTR("BWStillImageCaptureSettings"), NULL)) {
        NSDictionary *metadata = (__bridge NSDictionary *)CMGetAttachment(sample, CFSTR("MetadataDictionary"), NULL);
        if ([metadata isKindOfClass:[NSDictionary class]] &&
            [metadata[@"PortType"] isEqual:@"OBSBridgeStill"]) {
            [g_lock lock];
            BOOL active = leaseValid();
            [g_lock unlock];
            if (active) {
                id backOutput = ((id (*)(id, SEL, id))objc_msgSend)(node,
                    sel_registerName("outputForPortType:"), @"PortTypeBack");
                id bridgeOutput = ((id (*)(id, SEL, id))objc_msgSend)(node,
                    sel_registerName("outputForPortType:"), @"OBSBridgeStill");
                [g_lock lock];
                g_lastTimeMachineFrame = @{
                    @"backOutput":@(backOutput != nil),
                    @"bridgeOutput":@(bridgeOutput != nil),
                    @"hasImage":@(CMSampleBufferGetImageBuffer(sample) != NULL),
                    @"settingsID":numericGetter((__bridge id)CMGetAttachment(sample,
                        CFSTR("BWStillImageCaptureSettings"), NULL), "settingsID")
                };
                [g_lock unlock];
                NSMutableDictionary *rewritten = [metadata mutableCopy];
                rewritten[@"PortType"] = @"PortTypeBack";
                CMSetAttachment(sample, CFSTR("MetadataDictionary"),
                    (__bridge CFTypeRef)rewritten, kCMAttachmentMode_ShouldPropagate);
                __atomic_add_fetch(&g_photoPortRemaps, 1, __ATOMIC_RELAXED);
            }
        }
    }
    g_originalTimeMachineRender(node, selector, sample, input);
}

static void bridgeTimeMachineHandle(id node, SEL selector, CMSampleBufferRef sample) {
    if (sample && CMGetAttachment(sample, CFSTR("BWStillImageCaptureSettings"), NULL))
        __atomic_add_fetch(&g_photoTimeMachineHandles, 1, __ATOMIC_RELAXED);
    g_originalTimeMachineHandle(node, selector, sample);
}

static BOOL bridgeTimeMachineComplete(id node, SEL selector) {
    BOOL complete = g_originalTimeMachineComplete(node, selector);
    __atomic_add_fetch(&g_photoTimeMachineCompleteChecks, 1, __ATOMIC_RELAXED);
    if (complete) __atomic_add_fetch(&g_photoTimeMachineCompleteTrue, 1, __ATOMIC_RELAXED);
    return complete;
}

static void bridgeOutputEmit(id output, SEL selector, CMSampleBufferRef sample) {
    id owner = getObject(output, "node");
    CVImageBufferRef image = sample ? CMSampleBufferGetImageBuffer(sample) : NULL;
    BOOL tagged = sample && CMGetAttachment(sample, CFSTR("BWStillImageCaptureSettings"), NULL);
    size_t width = image ? CVPixelBufferGetWidth(image) : 0;
    [g_lock lock];
    BOOL photoRequested = g_photoStillRequests > 0 && leaseValid();
    [g_lock unlock];
    if (owner && sample && (tagged || width >= 3000) &&
        photoRequested) {
        id connection = getObject(output, "connection");
        id destination = getObject(getObject(connection, "input"), "node");
        const uint8_t *bytes = connection ? (const uint8_t *)(__bridge const void *)connection : NULL;
        NSDictionary *entry = @{
            @"source":NSStringFromClass(object_getClass(owner)),
            @"destination":destination ? NSStringFromClass(object_getClass(destination)) : @"<nil>",
            @"width":@(width),
            @"hasSettings":@(tagged),
            @"hasConnection":@(connection != nil),
            @"suspended":@(bytes && bytes[0x28] != 0),
            @"eventsOnly":@(bytes && bytes[0x2c] != 0)
        };
        [g_lock lock];
        if (g_photoRoute.count < 64) [g_photoRoute addObject:entry];
        [g_lock unlock];
    }
    if (owner && [owner isKindOfClass:objc_getClass("BWStillImageCoordinatorNode")] && sample)
        __atomic_add_fetch(&g_photoCoordinatorOutputEmits, 1, __ATOMIC_RELAXED);
    if (owner && [owner isKindOfClass:objc_getClass("BWStillImageTimeMachineFrameCoordinatorNode")] &&
        sample && CMGetAttachment(sample, CFSTR("BWStillImageCaptureSettings"), NULL)) {
        __atomic_add_fetch(&g_photoTimeMachineOutputEmits, 1, __ATOMIC_RELAXED);
        id connection = getObject(output, "connection");
        id input = getObject(connection, "input");
        id destination = getObject(input, "node");
        const uint8_t *bytes = connection ? (const uint8_t *)(__bridge const void *)connection : NULL;
        BOOL suspended = bytes && bytes[0x28] != 0;
        BOOL eventsOnly = bytes && bytes[0x2c] != 0;
        [g_lock lock];
        BOOL active = leaseValid();
        g_lastTimeMachineFrame = @{
            @"backOutput":@YES,
            @"destination":destination ? NSStringFromClass(object_getClass(destination)) : @"<nil>",
            @"hasConnection":@(connection != nil),
            @"suspendedBeforeEmit":@(suspended),
            @"eventsOnlyBeforeEmit":@(eventsOnly),
            @"hasImage":@(CMSampleBufferGetImageBuffer(sample) != NULL),
            @"settingsID":numericGetter((__bridge id)CMGetAttachment(sample,
                CFSTR("BWStillImageCaptureSettings"), NULL), "settingsID")
        };
        [g_lock unlock];
        if (active && connection && (suspended || eventsOnly) &&
            hasABI(object_getClass(connection), "resumeForEventsOnly:", "v20@0:8B16")) {
            ((void (*)(id, SEL, BOOL))objc_msgSend)(connection,
                sel_registerName("resumeForEventsOnly:"), NO);
            __atomic_add_fetch(&g_photoTimeMachineConnectionsResumed, 1, __ATOMIC_RELAXED);
        }
    }
    g_originalOutputEmit(output, selector, sample);
}

static void bridgeCoordinatorRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
    BOOL tagged = sample && CMGetAttachment(sample, CFSTR("BWStillImageCaptureSettings"), NULL);
    if (tagged)
        __atomic_add_fetch(&g_photoCoordinatorRenders, 1, __ATOMIC_RELAXED);
    g_originalCoordinatorRender(node, selector, sample, input);
    if (tagged) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_MSEC * 250), g_controlQueue, ^{
            id resolved = ivarObject(node, "_currentResolvedStillImageCaptureSettings");
            id received = ivarObject(node, "_receivedImagesOrErrorsForRequestByPortType");
            NSDictionary *snapshot = @{
                @"active":ivarNumber(node, "_active"),
                @"clientExpected":ivarNumber(node, "_clientExpectedImagesOrErrorsForRequest"),
                @"clientReceived":ivarNumber(node, "_clientReceivedImagesOrErrorsForRequest"),
                @"resolvedSettingsID":numericGetter(resolved, "settingsID"),
                @"receivedByPort":received ? [received description] : @"<nil>",
                @"coordinatorOutputEmits":@(__atomic_load_n(&g_photoCoordinatorOutputEmits, __ATOMIC_RELAXED))
            };
            [g_lock lock];
            g_lastCoordinatorState = snapshot;
            [g_lock unlock];
        });
    }
}

static void bridgeGNRRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
    BOOL tagged = sample && CMGetAttachment(sample, CFSTR("BWStillImageCaptureSettings"), NULL);
    [g_lock lock];
    BOOL active = tagged && leaseValid();
    [g_lock unlock];
    if (!active) {
        g_originalGNRRender(node, selector, sample, input);
        return;
    }
    CVImageBufferRef image = CMSampleBufferGetImageBuffer(sample);
    size_t width = image ? CVPixelBufferGetWidth(image) : 0;
    size_t height = image ? CVPixelBufferGetHeight(image) : 0;
    OSType pixel = image ? CVPixelBufferGetPixelFormatType(image) : 0;
    char code[5] = {(char)(pixel >> 24), (char)(pixel >> 16),
                    (char)(pixel >> 8), (char)pixel, 0};
    NSMutableArray *connected = [NSMutableArray array];
    id outputs = getObject(node, "outputs");
    if ([outputs isKindOfClass:[NSArray class]]) {
        for (id output in (NSArray *)outputs) {
            if (getObject(output, "connection")) [connected addObject:output];
        }
    }
    id output = connected.count == 1 ? connected.firstObject : nil;
    NSString *inputFormat = [getObject(input, "liveFormat") description] ?: @"<nil>";
    NSString *outputFormat = [getObject(output, "liveFormat") description] ?: @"<nil>";
    NSString *dimension = [NSString stringWithFormat:@"%zu x %zu", width, height];
    NSString *pixelCode = [NSString stringWithUTF8String:code] ?: @"<invalid>";
    BOOL compatible = image && output &&
        [outputFormat containsString:dimension] && [outputFormat containsString:pixelCode];
    [g_lock lock];
    g_lastGNRFrame = @{
        @"connectedOutputs":@(connected.count), @"inputFormat":inputFormat,
        @"outputFormat":outputFormat, @"sampleDimensions":dimension,
        @"samplePixelFormat":pixelCode, @"compatible":@(compatible)
    };
    [g_lock unlock];
    if (compatible) {
        ((void (*)(id, SEL, CMSampleBufferRef))objc_msgSend)(output,
            sel_registerName("emitSampleBuffer:"), sample);
        __atomic_add_fetch(&g_photoGNRBypasses, 1, __ATOMIC_RELAXED);
    } else {
        g_originalGNRRender(node, selector, sample, input);
    }
}

// The native recording branch delivers its own boundary/control samples to
// this compressor. Remember that exact input, then feed OBS image samples to
// it without changing graph connections or interrupting those messages.
static void bridgeCompressorRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
    if (sample && CMSampleBufferGetImageBuffer(sample))
        __atomic_add_fetch(&g_compressorImageSamples, 1, __ATOMIC_RELAXED);
    else
        __atomic_add_fetch(&g_compressorControlSamples, 1, __ATOMIC_RELAXED);
    NSString *inputFormat = [getObject(input, "liveFormat") description];
    if (input && g_videoInjection && [inputFormat containsString:@"1920 x 1080"] &&
        [inputFormat containsString:@"420v"]) {
        id graph = getObject(node, "graph");
        [g_lock lock];
        if (leaseValid() && [g_redirectedGraphs containsObject:
                [NSValue valueWithPointer:(__bridge const void *)graph]]) {
            for (OBSBridgeContext *ctx in g_contexts.allValues) {
                if (ctx.graph == graph && ctx.masterSource) {
                    ctx.recordCompressor = node;
                    ctx.recordInput = input;
                    break;
                }
            }
        }
        [g_lock unlock];
    }
    g_originalCompressorRender(node, selector, sample, input);
}

static void bridgeDeferredStartHook(id graph, SEL selector) {
    g_originalDeferredStart(graph, selector);
}

static void bridgeDeferredPrepareHook(id graph, SEL selector, id handler) {
    g_originalDeferredPrepare(graph, selector, handler);
}

static BOOL bridgeGraphStop(id graph, SEL selector, void *error) {
    [g_lock lock];
    if ([g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]]) g_graphStops++;
    NSMutableArray *keys = [NSMutableArray array];
    for (NSValue *key in g_contexts) {
        OBSBridgeContext *ctx = g_contexts[key];
        if (ctx.graph == graph) {
            ctx.running = NO;
            if (ctx.timer) { dispatch_source_cancel(ctx.timer); ctx.timer = nil; }
            [ctx.networkSession invalidateAndCancel];
            [keys addObject:key];
        }
    }
    [g_lock unlock];
    // Keep the mapping while BWGraph calls each node's stop:. The physical
    // node was never started, so its stop must remain suppressed as well.
    BOOL stopped = g_originalGraphStop ? g_originalGraphStop(graph, selector, error) : NO;
    [g_lock lock];
    for (NSValue *key in keys) [g_contexts removeObjectForKey:key];
    [g_redirectedGraphs removeObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    [g_lock unlock];
    return stopped;
}

static void installHooks(void) {
    if (g_hookAttempted) return;
    Class graph = objc_getClass("BWGraph");
    g_physicalClass = objc_getClass("BWMultiStreamCameraSourceNode");
    Class software = objc_getClass("BWDeferredProcessingSourceNode");
    Class metadata = objc_getClass("BWMetadataSourceNode");
    Class node = objc_getClass("BWNode");
    Class output = objc_getClass("BWNodeOutput");
    if (!hasABI(graph, "connectOutput:toInput:pipelineStage:", "B40@0:8@16@24@32") ||
        !hasABI(graph, "start:", "B24@0:8^@16") ||
        !hasABI(graph, "stop:", "B24@0:8^@16") ||
        !hasABI(graph, "commitConfigurationWithID:error:", "B32@0:8q16^@24") ||
        !hasABI(graph, "applicationID", "@16@0:8") ||
        !hasABI(node, "graph", "@16@0:8") ||
        !hasABI(output, "node", "@16@0:8") ||
        !hasABI(g_physicalClass, "start:", "B24@0:8^@16") ||
        !hasABI(g_physicalClass, "stop:", "B24@0:8^@16") ||
        !hasABI(g_physicalClass, "allocateOrReuseBufferPoolsFromSourceNode:", "i24@0:8@16") ||
        !hasABI(g_physicalClass, "videoCaptureOutput", "@16@0:8") ||
        !hasABI(g_physicalClass, "stillImageOutput", "@16@0:8") ||
        !hasABI(g_physicalClass, "detectedObjectsOutput", "@16@0:8") ||
        !hasABI(software, "initWithPortTypes:attributes:colorSpaceProperties:", "@36@0:8@16@24i32") ||
        !hasABI(software, "outputForPortType:", "@24@0:8@16") ||
        !hasABI(software, "processBuffer:", "v24@0:8^{opaqueCMSampleBuffer=}16") ||
        !hasABI(metadata, "initWithFormatDescription:clock:", "@32@0:8^{opaqueCMFormatDescription=}16^{OpaqueCMClock=}24") ||
        !hasABI(metadata, "output", "@16@0:8")) return;
    g_hookAttempted = YES;
    Class pressure = objc_getClass("BWBackPressureNode");
    Class device = objc_getClass("BWFigVideoCaptureDevice");
    Class stream = objc_getClass("BWFigVideoCaptureStream");
    Class timeMachine = objc_getClass("BWStillImageTimeMachineFrameCoordinatorNode");
    Class coordinator = objc_getClass("BWStillImageCoordinatorNode");
    Class gnr = objc_getClass("BWGNRNode");
    Class compressor = objc_getClass("BWVideoCompressorNode");
    if (hasABI(device, "prepareToCaptureStillImageNow:", "v24@0:8@?16"))
        MSHookMessageEx(device, sel_registerName("prepareToCaptureStillImageNow:"),
            (IMP)bridgeDevicePrepare, (IMP *)&g_originalDevicePrepare);
    if (hasABI(stream, "prepareForStillImageCaptureFromFirmwareWithStillImageSettings:", "v24@0:8@16"))
        MSHookMessageEx(stream, sel_registerName("prepareForStillImageCaptureFromFirmwareWithStillImageSettings:"),
            (IMP)bridgeStreamPrepareStill, (IMP *)&g_originalStreamPrepareStill);
    if (hasABI(timeMachine, "renderSampleBuffer:forInput:", "v32@0:8^{opaqueCMSampleBuffer=}16@24"))
        MSHookMessageEx(timeMachine, sel_registerName("renderSampleBuffer:forInput:"),
            (IMP)bridgeTimeMachineRender, (IMP *)&g_originalTimeMachineRender);
    if (hasABI(timeMachine, "_handleSampleBuffer:", "v24@0:8^{opaqueCMSampleBuffer=}16"))
        MSHookMessageEx(timeMachine, sel_registerName("_handleSampleBuffer:"),
            (IMP)bridgeTimeMachineHandle, (IMP *)&g_originalTimeMachineHandle);
    if (hasABI(timeMachine, "_isCaptureComplete", "B16@0:8"))
        MSHookMessageEx(timeMachine, sel_registerName("_isCaptureComplete"),
            (IMP)bridgeTimeMachineComplete, (IMP *)&g_originalTimeMachineComplete);
    if (hasABI(output, "emitSampleBuffer:", "v24@0:8^{opaqueCMSampleBuffer=}16"))
        MSHookMessageEx(output, sel_registerName("emitSampleBuffer:"),
            (IMP)bridgeOutputEmit, (IMP *)&g_originalOutputEmit);
    if (hasABI(coordinator, "renderSampleBuffer:forInput:", "v32@0:8^{opaqueCMSampleBuffer=}16@24"))
        MSHookMessageEx(coordinator, sel_registerName("renderSampleBuffer:forInput:"),
            (IMP)bridgeCoordinatorRender, (IMP *)&g_originalCoordinatorRender);
    if (hasABI(gnr, "renderSampleBuffer:forInput:", "v32@0:8^{opaqueCMSampleBuffer=}16@24"))
        MSHookMessageEx(gnr, sel_registerName("renderSampleBuffer:forInput:"),
            (IMP)bridgeGNRRender, (IMP *)&g_originalGNRRender);
    if (hasABI(compressor, "renderSampleBuffer:forInput:", "v32@0:8^{opaqueCMSampleBuffer=}16@24"))
        MSHookMessageEx(compressor, sel_registerName("renderSampleBuffer:forInput:"),
            (IMP)bridgeCompressorRender, (IMP *)&g_originalCompressorRender);
    if (hasABI(pressure, "setInitialSemaphoreValue:", "v20@0:8i16"))
        MSHookMessageEx(pressure, sel_registerName("setInitialSemaphoreValue:"),
            (IMP)bridgeInitialSemaphore, (IMP *)&g_originalInitialSemaphore);
    MSHookMessageEx(graph, sel_registerName("connectOutput:toInput:pipelineStage:"),
        (IMP)redirectedConnect, (IMP *)&g_originalConnect);
    MSHookMessageEx(g_physicalClass, sel_registerName("start:"),
        (IMP)suppressedPhysicalStart, (IMP *)&g_originalPhysicalStart);
    MSHookMessageEx(g_physicalClass, sel_registerName("stop:"),
        (IMP)suppressedPhysicalStop, (IMP *)&g_originalPhysicalStop);
    MSHookMessageEx(g_physicalClass, sel_registerName("allocateOrReuseBufferPoolsFromSourceNode:"),
        (IMP)suppressedPhysicalPools, (IMP *)&g_originalPhysicalPools);
    if (hasABI(g_physicalClass, "clock", "@16@0:8"))
        MSHookMessageEx(g_physicalClass, sel_registerName("clock"),
            (IMP)physicalClockOverride, (IMP *)&g_originalPhysicalClock);
    Class outputClass = objc_getClass("BWNodeOutput");
    if (outputClass && hasABI(outputClass,
        "emitStillImageReferenceFrameBracketedCaptureSequenceNumberMessageWithSequenceNumber:", "v28@0:8q16"))
        g_originalPhysicalEmitSequence = (void (*)(id, SEL, long long))class_getMethodImplementation(
            outputClass, sel_registerName(
            "emitStillImageReferenceFrameBracketedCaptureSequenceNumberMessageWithSequenceNumber:"));
    MSHookMessageEx(graph, sel_registerName("start:"),
        (IMP)bridgeGraphStart, (IMP *)&g_originalGraphStart);
    MSHookMessageEx(graph, sel_registerName("stop:"),
        (IMP)bridgeGraphStop, (IMP *)&g_originalGraphStop);
    MSHookMessageEx(graph, sel_registerName("commitConfigurationWithID:error:"),
        (IMP)bridgeGraphCommit, (IMP *)&g_originalGraphCommit);
    if (hasABI(graph, "startDeferredSourceNodesIfNeeded", "v16@0:8"))
        MSHookMessageEx(graph, sel_registerName("startDeferredSourceNodesIfNeeded"),
            (IMP)bridgeDeferredStartHook, (IMP *)&g_originalDeferredStart);
    if (hasABI(graph, "startDeferredNodePrepareIfNeededWithCompletionHandler:", "v24@0:8@?16"))
        MSHookMessageEx(graph, sel_registerName("startDeferredNodePrepareIfNeededWithCompletionHandler:"),
            (IMP)bridgeDeferredPrepareHook, (IMP *)&g_originalDeferredPrepare);
    g_hooksReady = g_originalConnect && g_originalPhysicalStart && g_originalPhysicalStop &&
        g_originalPhysicalPools && g_originalGraphStart && g_originalGraphStop && g_originalGraphCommit;
}

%ctor {
    @autoreleasepool {
        if (![[NSProcessInfo processInfo].processName isEqualToString:@"mediaserverd"]) return;
        g_lock = [NSRecursiveLock new];
        g_contexts = [NSMutableDictionary new];
        g_redirectedGraphs = [NSMutableSet new];
        g_graphClasses = [NSMutableSet new];
        g_photoRoute = [NSMutableArray new];
        g_controlQueue = dispatch_queue_create("com.aquiles.obsgraphbridge.control", DISPATCH_QUEUE_SERIAL);
        dispatch_async(g_controlQueue, ^{
            g_statusTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, g_controlQueue);
            dispatch_source_set_timer(g_statusTimer, DISPATCH_TIME_NOW, NSEC_PER_SEC, NSEC_PER_SEC/10);
            dispatch_source_set_event_handler(g_statusTimer, ^{ readControl(); installHooks(); saveStatus(); });
            dispatch_resume(g_statusTimer);
        });
    }
}
