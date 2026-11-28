#import "Ponte.h"

unsigned long long g_audioSequence;
static BOOL g_audioFetchPending;
NSURLSession *g_audioSession;
unsigned long g_audioReplaced;
unsigned long g_audioDropped;
unsigned long g_audioFetchFailures;
void (*g_originalMovieSinkRender)(id, SEL, CMSampleBufferRef, id);

void fetchAudio(void) {
    [g_lock lock];
    if (!leaseValid() || !g_audioInjection || g_audioFetchPending || g_audioPackets.count >= 12) {
        [g_lock unlock]; return;
    }
    g_audioFetchPending = YES;
    unsigned long long after = g_audioSequence;
    NSString *frameURLText = [g_url copy];
    NSString *socketPath = [g_socket copy];
    [g_lock unlock];
    NSURL *frameURL = [NSURL URLWithString:frameURLText];
    NSString *audioPath = [[[frameURL path] stringByReplacingOccurrencesOfString:@"/frame.jpg" withString:@"/audio"]
                           stringByAppendingFormat:@"?after=%llu", after];
    void (^handle)(NSData *, NSInteger) = ^(NSData *data, NSInteger status) {
        [g_lock lock];
        g_audioFetchPending = NO;
        const uint8_t *bytes = data.bytes;
        if (status != 200 || data.length < 4 || memcmp(bytes, "OBA1", 4)) {
            g_audioFetchFailures++;
        } else {
            NSUInteger offset = 4;
            while (offset + 10 <= data.length) {
                unsigned long long seq = 0;
                for (int i = 0; i < 8; i++) seq = (seq << 8) | bytes[offset + i];
                NSUInteger length = ((NSUInteger)bytes[offset + 8] << 8) | bytes[offset + 9];
                offset += 10;
                if (!length || length > 8192 || offset + length > data.length) break;
                if (seq > g_audioSequence && leaseValid() && g_audioInjection) {
                    [g_audioPackets addObject:[NSData dataWithBytes:bytes + offset length:length]];
                    g_audioSequence = seq;
                }
                offset += length;
            }
            while (g_audioPackets.count > 24) [g_audioPackets removeObjectAtIndex:0];
        }
        [g_lock unlock];
    };
    if (socketPath.length) {
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            NSData *data = httpGetOverUnix(socketPath, audioPath, 0.7, 32*8192);
            handle(data, data ? 200 : 0);
        });
        return;
    }
    NSString *urlText = [NSString stringWithFormat:@"http://%@:%@%@", frameURL.host, frameURL.port, audioPath];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:urlText]];
    request.timeoutInterval = 0.7;
    [[g_audioSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSInteger status = (!error && [(NSHTTPURLResponse *)response isKindOfClass:[NSHTTPURLResponse class]])
            ? ((NSHTTPURLResponse *)response).statusCode : 0;
        handle(data, status);
    }] resume];
}

static void copyAudioAttachment(const void *key, const void *value, void *context) {
    CFDictionarySetValue((CFMutableDictionaryRef)context, key, value);
}

static CMSampleBufferRef sampleWithAudioPacket(CMSampleBufferRef original, NSData *packet) {
    CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(original);
    if (!format || !packet.length) return NULL;
    CMBlockBufferRef block = NULL;
    OSStatus status = CMBlockBufferCreateWithMemoryBlock(kCFAllocatorDefault, NULL, packet.length,
        kCFAllocatorDefault, NULL, 0, packet.length, 0, &block);
    if (status || !block) return NULL;
    status = CMBlockBufferReplaceDataBytes(packet.bytes, block, 0, packet.length);
    CMSampleTimingInfo timing = {0};
    if (!status) status = CMSampleBufferGetSampleTimingInfo(original, 0, &timing);
    CMSampleBufferRef replacement = NULL;
    size_t size = packet.length;
    if (!status) status = CMSampleBufferCreateReady(kCFAllocatorDefault, block, format, 1, 1,
        &timing, 1, &size, &replacement);
    CFRelease(block);
    if (status || !replacement) return NULL;
    CFArrayRef from = CMSampleBufferGetSampleAttachmentsArray(original, false);
    CFArrayRef to = CMSampleBufferGetSampleAttachmentsArray(replacement, true);
    if (from && to && CFArrayGetCount(from) && CFArrayGetCount(to)) {
        CFDictionaryRef source = CFArrayGetValueAtIndex(from, 0);
        CFMutableDictionaryRef target = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(to, 0);
        CFDictionaryApplyFunction(source, copyAudioAttachment, target);
    }
    return replacement;
}

void bridgeMovieSinkRender(id node, SEL selector, CMSampleBufferRef sample, id input) {
    if (!g_originalMovieSinkRender) return;
    if (!sample) { g_originalMovieSinkRender(node, selector, sample, input); return; }
    CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sample);
    if (!format || CMFormatDescriptionGetMediaType(format) != kCMMediaType_Audio ||
        CMFormatDescriptionGetMediaSubType(format) != 'aac ') {
        g_originalMovieSinkRender(node, selector, sample, input); return;
    }
    id graph = getObject(node, "graph");
    [g_lock lock];
    BOOL active = leaseValid() && g_audioInjection &&
        [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    NSData *packet = nil;
    if (active && g_audioPackets.count) {
        packet = g_audioPackets.firstObject;
        [g_audioPackets removeObjectAtIndex:0];
    }
    [g_lock unlock];
    if (!active) { g_originalMovieSinkRender(node, selector, sample, input); return; }
    if (!packet) {
        static const uint8_t silence[] = {0x01, 0x18, 0x20, 0x07};
        packet = [NSData dataWithBytes:silence length:sizeof(silence)];
        __atomic_add_fetch(&g_audioDropped, 1, __ATOMIC_RELAXED);
    }
    CMSampleBufferRef replacement = sampleWithAudioPacket(sample, packet);
    if (!replacement) { __atomic_add_fetch(&g_audioDropped, 1, __ATOMIC_RELAXED); return; }
    g_originalMovieSinkRender(node, selector, replacement, input);
    __atomic_add_fetch(&g_audioReplaced, 1, __ATOMIC_RELAXED);
    CFRelease(replacement);
}
