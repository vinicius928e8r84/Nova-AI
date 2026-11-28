#import "Ponte.h"

static NSString *const kStatus = @"/var/tmp/obs-graph-bridge-status.json";

void saveStatus(void) {
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
        @"version":@"0.1-39", @"pid":@([NSProcessInfo processInfo].processIdentifier),
        @"observedAppIDs":g_observedAppIDs.allObjects,
        @"allowedAppIDs":g_allowedAppIDs.allObjects,
        @"audioInjection":@(g_audioInjection), @"audioQueued":@(g_audioPackets.count),
        @"audioSequence":@(g_audioSequence), @"audioReplaced":@(g_audioReplaced),
        @"audioDropped":@(g_audioDropped), @"audioFetchFailures":@(g_audioFetchFailures),
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
        @"remoteQueueRenders":@(g_remoteQueueRenders), @"remoteQueuePortRemaps":@(g_remoteQueuePortRemaps),
        @"remoteQueueRenderFailures":@(g_remoteQueueRenderFailures),
        @"remoteQueuePortType":g_remoteQueuePortType ?: @"",
        @"graphStopsSkipped":@(g_graphStopsSkipped),
        @"lastCommitError":g_lastCommitError ?: @""
    };
    [g_lock unlock];
    NSData *json = [NSJSONSerialization dataWithJSONObject:status options:NSJSONWritingPrettyPrinted error:nil];
    [json writeToFile:kStatus options:NSDataWritingAtomic error:nil];
}
