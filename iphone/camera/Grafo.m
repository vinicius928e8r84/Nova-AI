#import "Ponte.h"

Class g_physicalClass;
static Class g_softwareSourceClass;
BOOL g_faulted;
unsigned long g_redirected;
unsigned long g_contextLimitHits;
unsigned long g_startHookDispatchMisses;
unsigned long g_recordConnections;
BOOL (*g_originalConnect)(id, SEL, id, id, id);

@implementation OBSBridgeContext
@end

static OBSBridgeContext *contextForGraphAndPhysical(id graph, id physical) {
    NSValue *key = [NSValue valueWithPointer:(__bridge const void *)physical];
    OBSBridgeContext *ctx = g_contexts[key];
    if (!ctx) {
        if (g_contexts.count >= 4) {
            g_contextLimitHits++;
            g_faulted = YES;
            return nil;
        }
        ctx = [OBSBridgeContext new];
        ctx.graph = graph; ctx.physical = physical;
        ctx.masterSource = YES;
        for (OBSBridgeContext *existing in g_contexts.allValues)
            if (existing.graph == graph) { ctx.masterSource = NO; break; }
        g_contexts[key] = ctx;
    }
    return ctx;
}

static id createVideoSourceWithFormat(id graph, NSString *port, NSUInteger width, NSUInteger height, OSType pixelFormat) {
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

BOOL redirectedConnect(id graph, SEL selector, id output, id input, id stage) {
    @autoreleasepool {
        if (!g_originalConnect) return NO;
        NSValue *graphKey = [NSValue valueWithPointer:(__bridge const void *)graph];
        id appID = getObject(graph, "applicationID");
        [g_lock lock];
        if ([appID isKindOfClass:[NSString class]] && g_observedAppIDs.count < 32)
            [g_observedAppIDs addObject:appID];
        BOOL active = leaseValid(), previouslyRedirected = [g_redirectedGraphs containsObject:graphKey];
        BOOL requested = g_enabled && [[NSDate date] timeIntervalSince1970] < g_expires;
        [g_lock unlock];
        if (!active) {
            if (previouslyRedirected) return NO;
            if (requested && appAllowed(appID)) return NO;
            return g_originalConnect(graph, selector, output, input, stage);
        }
        if (!appAllowed(appID))
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
                if (!ctx.videoSource) {
                    NSUInteger width = 1584, height = 1188;
                    id format = getObject(output, "liveFormat") ?: getObject(output, "format");
                    if (format && CMFormatDescriptionGetMediaType((__bridge CMFormatDescriptionRef)format) == kCMMediaType_Video) {
                        CMVideoDimensions dims = CMVideoFormatDescriptionGetDimensions(
                            (__bridge CMVideoFormatDescriptionRef)format);
                        if (dims.width >= 320 && dims.width <= 4096 && dims.height >= 240 && dims.height <= 4096) {
                            width = dims.width; height = dims.height;
                        }
                    }
                    ctx.videoWidth = width; ctx.videoHeight = height;
                    ctx.videoSource = createVideoSource(graph, @"OBSBridgeVideo", width, height);
                }
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
