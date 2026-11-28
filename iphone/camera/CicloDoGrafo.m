#import "Ponte.h"

unsigned long g_suppressedStarts;
unsigned long g_graphStarts;
unsigned long g_graphStartFailures;
unsigned long g_graphStops;
unsigned long g_graphCommits;
unsigned long g_graphCommitFailures;
unsigned long g_connectionsResumed;
unsigned long g_graphStopsSkipped;
unsigned long g_minimumBufferBudgets;
void (*g_originalInitialSemaphore)(id, SEL, int32_t);
NSString *g_lastCommitError;
BOOL (*g_originalPhysicalStart)(id, SEL, void *);
BOOL (*g_originalPhysicalStop)(id, SEL, void *);
BOOL (*g_originalPhysicalPools)(id, SEL, id);
id (*g_originalPhysicalClock)(id, SEL);
BOOL (*g_originalGraphStart)(id, SEL, void *);
void (*g_originalDeferredStart)(id, SEL);
void (*g_originalDeferredPrepare)(id, SEL, id);
BOOL (*g_originalGraphStop)(id, SEL, void *);
BOOL (*g_originalGraphCommit)(id, SEL, long long, id *);

id physicalClockOverride(id node, SEL selector) {
    [g_lock lock];
    BOOL mapped = g_contexts[[NSValue valueWithPointer:(__bridge const void *)node]] != nil;
    [g_lock unlock];
    if (mapped) return (__bridge id)CMClockGetHostTimeClock();
    return g_originalPhysicalClock ? g_originalPhysicalClock(node, selector) : nil;
}

static void resumeContextConnections(OBSBridgeContext *ctx) {
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

BOOL suppressedPhysicalStart(id node, SEL selector, void *error) {
    [g_lock lock];
    OBSBridgeContext *ctx = g_contexts[[NSValue valueWithPointer:(__bridge const void *)node]];
    id graph = getObject(node, "graph");
    BOOL mapped = ctx != nil || [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    BOOL cameraGraph = [getObject(graph, "applicationID") isEqual:kCameraApp];
    BOOL ready = mapped && leaseValid() && ctx.videoConnected &&
        (!cameraGraph || (ctx.stillConnected && ctx.metadataConnected));
    if (mapped) g_suppressedStarts++;
    [g_lock unlock];
    if (!mapped) return g_originalPhysicalStart ? g_originalPhysicalStart(node, selector, error) : NO;
    return ready;
}

BOOL suppressedPhysicalStop(id node, SEL selector, void *error) {
    [g_lock lock];
    id graph = getObject(node, "graph");
    BOOL mapped = g_contexts[[NSValue valueWithPointer:(__bridge const void *)node]] != nil ||
        [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    [g_lock unlock];
    return mapped ? YES : (g_originalPhysicalStop ? g_originalPhysicalStop(node, selector, error) : NO);
}

int32_t suppressedPhysicalPools(id node, SEL selector, id source) {
    [g_lock lock];
    BOOL mapped = g_contexts[[NSValue valueWithPointer:(__bridge const void *)node]] != nil;
    BOOL active = leaseValid();
    [g_lock unlock];
    if (mapped && active) return 0;
    return g_originalPhysicalPools ? g_originalPhysicalPools(node, selector, source) : -12780;
}

BOOL bridgeGraphStart(id graph, SEL selector, void *error) {
    if (!g_originalGraphStart) return NO;
    [g_lock lock];
    BOOL mapped = [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    if (mapped) g_graphStarts++;
    [g_lock unlock];
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

BOOL bridgeGraphCommit(id graph, SEL selector, long long configurationID, id *error) {
    if (!g_originalGraphCommit) return NO;
    [g_lock lock];
    BOOL mapped = [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    [g_lock unlock];
    BOOL committed = NO;
    @try {
        committed = g_originalGraphCommit(graph, selector, configurationID, error);
    } @catch (NSException *exception) {
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

void bridgeInitialSemaphore(id node, SEL selector, int32_t capacity) {
    id graph = getObject(node, "graph");
    [g_lock lock];
    BOOL mapped = [g_redirectedGraphs containsObject:
        [NSValue valueWithPointer:(__bridge const void *)graph]];
    if (mapped && capacity == 0) { capacity = 1; g_minimumBufferBudgets++; }
    [g_lock unlock];
    g_originalInitialSemaphore(node, selector, capacity);
}

void bridgeDeferredStartHook(id graph, SEL selector) {
    g_originalDeferredStart(graph, selector);
}

void bridgeDeferredPrepareHook(id graph, SEL selector, id handler) {
    g_originalDeferredPrepare(graph, selector, handler);
}

BOOL bridgeGraphStop(id graph, SEL selector, void *error) {
    [g_lock lock];
    BOOL mapped = [g_redirectedGraphs containsObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    if (mapped) g_graphStops++;
    BOOL cameraGraph = mapped && [getObject(graph, "applicationID") isEqual:kCameraApp];
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
    BOOL stopped = YES;
    if (!mapped || cameraGraph) {
        stopped = g_originalGraphStop ? g_originalGraphStop(graph, selector, error) : NO;
    } else {
        __atomic_add_fetch(&g_graphStopsSkipped, 1, __ATOMIC_RELAXED);
    }
    [g_lock lock];
    for (NSValue *key in keys) [g_contexts removeObjectForKey:key];
    [g_redirectedGraphs removeObject:[NSValue valueWithPointer:(__bridge const void *)graph]];
    [g_lock unlock];
    return stopped;
}
