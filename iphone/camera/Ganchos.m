#import "Ponte.h"

NSRecursiveLock *g_lock;
NSMutableDictionary<NSValue *, id> *g_contexts;
NSMutableSet<NSValue *> *g_redirectedGraphs;
NSMutableSet<NSString *> *g_graphClasses;
NSMutableSet<NSString *> *g_observedAppIDs;
dispatch_queue_t g_controlQueue;
static dispatch_source_t g_statusTimer;
static dispatch_source_t g_audioTimer;
BOOL g_hooksReady;
static BOOL g_hookAttempted;
NSMutableArray<NSData *> *g_audioPackets;
NSMutableArray *g_photoRoute;

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
    Class movieSink = objc_getClass("BWQuickTimeMovieFileSinkNode");
    Class queueSink = objc_getClass("BWRemoteQueueSinkNode");
    if (hasABI(movieSink, "renderSampleBuffer:forInput:", "v32@0:8^{opaqueCMSampleBuffer=}16@24"))
        MSHookMessageEx(movieSink, sel_registerName("renderSampleBuffer:forInput:"),
            (IMP)bridgeMovieSinkRender, (IMP *)&g_originalMovieSinkRender);
    if (hasABI(queueSink, "renderSampleBuffer:forInput:", "v32@0:8^{opaqueCMSampleBuffer=}16@24"))
        MSHookMessageEx(queueSink, sel_registerName("renderSampleBuffer:forInput:"),
            (IMP)bridgeQueueSinkRender, (IMP *)&g_originalQueueSinkRender);
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

__attribute__((constructor)) static void iniciarPonte(void) {
    @autoreleasepool {
        if (![[NSProcessInfo processInfo].processName isEqualToString:@"mediaserverd"]) return;
        g_lock = [NSRecursiveLock new];
        g_contexts = [NSMutableDictionary new];
        g_redirectedGraphs = [NSMutableSet new];
        g_graphClasses = [NSMutableSet new];
        g_observedAppIDs = [NSMutableSet new];
        g_allowedAppIDs = [NSSet set];
        g_photoRoute = [NSMutableArray new];
        g_audioPackets = [NSMutableArray new];
        NSURLSessionConfiguration *audioConfig = [NSURLSessionConfiguration ephemeralSessionConfiguration];
        audioConfig.timeoutIntervalForRequest = 0.7;
        g_audioSession = [NSURLSession sessionWithConfiguration:audioConfig];
        g_controlQueue = dispatch_queue_create("com.aquiles.obsgraphbridge.control", DISPATCH_QUEUE_SERIAL);
        dispatch_async(g_controlQueue, ^{
            g_statusTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, g_controlQueue);
            dispatch_source_set_timer(g_statusTimer, DISPATCH_TIME_NOW, NSEC_PER_SEC, NSEC_PER_SEC/10);
            dispatch_source_set_event_handler(g_statusTimer, ^{ readControl(); installHooks(); saveStatus(); });
            dispatch_resume(g_statusTimer);
            g_audioTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, g_controlQueue);
            dispatch_source_set_timer(g_audioTimer, DISPATCH_TIME_NOW, NSEC_PER_MSEC * 100, NSEC_PER_MSEC * 20);
            dispatch_source_set_event_handler(g_audioTimer, ^{ fetchAudio(); });
            dispatch_resume(g_audioTimer);
        });
    }
}
