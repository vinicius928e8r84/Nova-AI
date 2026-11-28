#import "Ponte.h"

unsigned long g_photoPrepareBypasses;
unsigned long g_photoStillRequests;
unsigned long g_photoPortRemaps;
unsigned long g_photoTimeMachineHandles;
unsigned long g_photoTimeMachineOutputEmits;
unsigned long g_photoTimeMachineCompleteChecks;
unsigned long g_photoTimeMachineCompleteTrue;
unsigned long g_photoTimeMachineConnectionsResumed;
unsigned long g_photoCoordinatorRenders;
unsigned long g_photoSyntheticWillCaptures;
unsigned long g_photoCoordinatorOutputEmits;
unsigned long g_photoGNRBypasses;
NSDictionary *g_lastPhotoStreamSettings;
NSDictionary *g_lastTimeMachineFrame;
NSDictionary *g_lastCoordinatorState;
NSDictionary *g_lastGNRFrame;
void (*g_originalDevicePrepare)(id, SEL, id);
void (*g_originalStreamPrepareStill)(id, SEL, id);
void (*g_originalTimeMachineRender)(id, SEL, CMSampleBufferRef, id);
void (*g_originalTimeMachineHandle)(id, SEL, CMSampleBufferRef);
BOOL (*g_originalTimeMachineComplete)(id, SEL);
void (*g_originalOutputEmit)(id, SEL, CMSampleBufferRef);
void (*g_originalCoordinatorRender)(id, SEL, CMSampleBufferRef, id);
void (*g_originalGNRRender)(id, SEL, CMSampleBufferRef, id);

void bridgeDevicePrepare(id device, SEL selector, id completion) {
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
    void (^reply)(int32_t) = [completion copy];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_MSEC * 100), g_controlQueue, ^{
        reply(0);
    });
}

void bridgeStreamPrepareStill(id stream, SEL selector, id settings) {
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

void bridgeTimeMachineRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
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

void bridgeTimeMachineHandle(id node, SEL selector, CMSampleBufferRef sample) {
    if (sample && CMGetAttachment(sample, CFSTR("BWStillImageCaptureSettings"), NULL))
        __atomic_add_fetch(&g_photoTimeMachineHandles, 1, __ATOMIC_RELAXED);
    g_originalTimeMachineHandle(node, selector, sample);
}

BOOL bridgeTimeMachineComplete(id node, SEL selector) {
    BOOL complete = g_originalTimeMachineComplete(node, selector);
    __atomic_add_fetch(&g_photoTimeMachineCompleteChecks, 1, __ATOMIC_RELAXED);
    if (complete) __atomic_add_fetch(&g_photoTimeMachineCompleteTrue, 1, __ATOMIC_RELAXED);
    return complete;
}

void bridgeOutputEmit(id output, SEL selector, CMSampleBufferRef sample) {
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

void bridgeCoordinatorRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
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

void bridgeGNRRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
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
