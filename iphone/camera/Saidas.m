#import "Ponte.h"

unsigned long g_compressorImageSamples;
unsigned long g_compressorControlSamples;
void (*g_originalCompressorRender)(id, SEL, CMSampleBufferRef, id);
void (*g_originalQueueSinkRender)(id, SEL, CMSampleBufferRef, id);
unsigned long g_remoteQueueRenders;
unsigned long g_remoteQueuePortRemaps;
unsigned long g_remoteQueueRenderFailures;

void bridgeCompressorRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
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

void bridgeQueueSinkRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
    if (!g_originalQueueSinkRender) return;
    @autoreleasepool {
        __atomic_add_fetch(&g_remoteQueueRenders, 1, __ATOMIC_RELAXED);
        id graph = nil;
        BOOL redirected = NO;
        NSString *portType = nil;
        if (sample && CMSampleBufferGetImageBuffer(sample)) {
            NSDictionary *metadata = (__bridge NSDictionary *)CMGetAttachment(sample,
                CFSTR("MetadataDictionary"), NULL);
            id port = [metadata isKindOfClass:[NSDictionary class]] ? metadata[@"PortType"] : nil;
            if ([port isKindOfClass:[NSString class]] && [port hasPrefix:@"OBSBridge"]) {
                graph = getObject(node, "graph");
                [g_lock lock];
                redirected = [g_redirectedGraphs containsObject:
                    [NSValue valueWithPointer:(__bridge const void *)graph]];
                if (redirected && leaseValid()) portType = g_remoteQueuePortType;
                [g_lock unlock];
                if (redirected && portType && [portType length] &&
                    ![port isEqualToString:portType]) {
                    NSMutableDictionary *rewritten = [metadata mutableCopy];
                    rewritten[@"PortType"] = portType;
                    CMSetAttachment(sample, CFSTR("MetadataDictionary"),
                        (__bridge CFTypeRef)rewritten, kCMAttachmentMode_ShouldPropagate);
                    __atomic_add_fetch(&g_remoteQueuePortRemaps, 1, __ATOMIC_RELAXED);
                }
            }
        }
        @try {
            g_originalQueueSinkRender(node, selector, sample, input);
        } @catch (NSException *exception) {
            if (!redirected) @throw;
            __atomic_add_fetch(&g_remoteQueueRenderFailures, 1, __ATOMIC_RELAXED);
            [g_lock lock];
            g_lastCommitError = [NSString stringWithFormat:@"queueSink %@: %@",
                exception.name, exception.reason ?: @""];
            [g_lock unlock];
        }
    }
}
