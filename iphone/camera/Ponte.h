#pragma once
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <substrate.h>
#import <sys/socket.h>
#import <sys/un.h>
#import <sys/time.h>
#import <string.h>
#import <dispatch/dispatch.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>

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
@property (nonatomic, copy) NSString *socket;
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
@property NSUInteger videoWidth, videoHeight;
@property (nonatomic, strong) NSURLSession *networkSession;
@property (nonatomic, strong) id pendingPhotoSettings;
@property (nonatomic, strong) id pendingPhotoStream;
@end

#pragma GCC visibility push(hidden)

extern NSString *const kCameraApp;
extern Class g_physicalClass;
extern NSRecursiveLock *g_lock;
extern NSMutableDictionary<NSValue *, id> *g_contexts;
extern NSMutableSet<NSValue *> *g_redirectedGraphs;
extern NSMutableSet<NSString *> *g_graphClasses;
extern NSMutableSet<NSString *> *g_observedAppIDs;
extern NSSet<NSString *> *g_allowedAppIDs;
extern dispatch_queue_t g_controlQueue;
extern BOOL g_hooksReady;
extern BOOL g_faulted;
extern BOOL g_enabled;
extern BOOL g_previewOnly;
extern BOOL g_continuous;
extern BOOL g_directRecording;
extern BOOL g_videoInjection;
extern BOOL g_audioInjection;
extern NSMutableArray<NSData *> *g_audioPackets;
extern unsigned long long g_audioSequence;
extern NSURLSession *g_audioSession;
extern unsigned long g_audioReplaced;
extern unsigned long g_audioDropped;
extern unsigned long g_audioFetchFailures;
extern void (*g_originalMovieSinkRender)(id, SEL, CMSampleBufferRef, id);
extern BOOL g_photoPrepareBypass;
extern int g_frameRate;
extern NSTimeInterval g_expires;
extern NSString *g_url;
extern NSString *g_socket;
extern unsigned long g_redirected;
extern unsigned long g_suppressedStarts;
extern unsigned long g_emittedVideo;
extern unsigned long g_emittedStill;
extern unsigned long g_fetchFailures;
extern unsigned long g_graphStarts;
extern unsigned long g_graphStartFailures;
extern unsigned long g_graphStops;
extern unsigned long g_contextLimitHits;
extern unsigned long g_startHookDispatchMisses;
extern unsigned long g_graphCommits;
extern unsigned long g_graphCommitFailures;
extern unsigned long g_connectionsResumed;
extern unsigned long g_graphStopsSkipped;
extern unsigned long g_recordConnections;
extern unsigned long g_emittedRecord;
extern unsigned long g_compressorImageSamples;
extern unsigned long g_compressorControlSamples;
extern void (*g_originalCompressorRender)(id, SEL, CMSampleBufferRef, id);
extern void (*g_originalQueueSinkRender)(id, SEL, CMSampleBufferRef, id);
extern NSString *g_remoteQueuePortType;
extern unsigned long g_remoteQueueRenders;
extern unsigned long g_remoteQueuePortRemaps;
extern unsigned long g_remoteQueueRenderFailures;
extern unsigned long g_minimumBufferBudgets;
extern unsigned long g_photoPrepareBypasses;
extern unsigned long g_photoStillRequests;
extern unsigned long g_photoPortRemaps;
extern unsigned long g_photoTimeMachineHandles;
extern unsigned long g_photoTimeMachineOutputEmits;
extern unsigned long g_photoTimeMachineCompleteChecks;
extern unsigned long g_photoTimeMachineCompleteTrue;
extern unsigned long g_photoTimeMachineConnectionsResumed;
extern unsigned long g_photoCoordinatorRenders;
extern unsigned long g_photoSyntheticWillCaptures;
extern unsigned long g_photoSyntheticCompletions;
extern unsigned long g_photoCoordinatorOutputEmits;
extern unsigned long g_photoGNRBypasses;
extern NSDictionary *g_lastPhotoStreamSettings;
extern NSDictionary *g_lastTimeMachineFrame;
extern NSDictionary *g_lastCoordinatorState;
extern NSDictionary *g_lastGNRFrame;
extern NSMutableArray *g_photoRoute;
extern void (*g_originalInitialSemaphore)(id, SEL, int32_t);
extern void (*g_originalDevicePrepare)(id, SEL, id);
extern void (*g_originalStreamPrepareStill)(id, SEL, id);
extern void (*g_originalTimeMachineRender)(id, SEL, CMSampleBufferRef, id);
extern void (*g_originalTimeMachineHandle)(id, SEL, CMSampleBufferRef);
extern BOOL (*g_originalTimeMachineComplete)(id, SEL);
extern void (*g_originalOutputEmit)(id, SEL, CMSampleBufferRef);
extern void (*g_originalCoordinatorRender)(id, SEL, CMSampleBufferRef, id);
extern void (*g_originalGNRRender)(id, SEL, CMSampleBufferRef, id);
extern NSString *g_lastCommitError;
extern BOOL (*g_originalConnect)(id, SEL, id, id, id);
extern BOOL (*g_originalPhysicalStart)(id, SEL, void *);
extern BOOL (*g_originalPhysicalStop)(id, SEL, void *);
extern BOOL (*g_originalPhysicalPools)(id, SEL, id);
extern id (*g_originalPhysicalClock)(id, SEL);
extern void (*g_originalPhysicalEmitSequence)(id, SEL, long long);
extern BOOL (*g_originalGraphStart)(id, SEL, void *);
extern void (*g_originalDeferredStart)(id, SEL);
extern void (*g_originalDeferredPrepare)(id, SEL, id);
extern BOOL (*g_originalGraphStop)(id, SEL, void *);
extern BOOL (*g_originalGraphCommit)(id, SEL, long long, id *);

BOOL hasABI(Class cls, const char *name, const char *expected);
id getObject(id object, const char *name);
id numericGetter(id object, const char *name);
id ivarObject(id object, const char *name);
id ivarNumber(id object, const char *name);
NSString *roleForOutput(id physical, id output);
BOOL leaseValid(void);
NSData *httpGetOverUnix(NSString *socketPath, NSString *requestPath, NSTimeInterval timeout, NSUInteger maxBytes);
BOOL appAllowed(id appID);
void readControl(void);
void saveStatus(void);
void startProducer(OBSBridgeContext *ctx);
BOOL redirectedConnect(id graph, SEL selector, id output, id input, id stage);
id physicalClockOverride(id node, SEL selector);
BOOL suppressedPhysicalStart(id node, SEL selector, void *error);
BOOL suppressedPhysicalStop(id node, SEL selector, void *error);
int32_t suppressedPhysicalPools(id node, SEL selector, id source);
BOOL bridgeGraphStart(id graph, SEL selector, void *error);
BOOL bridgeGraphCommit(id graph, SEL selector, long long configurationID, id *error);
void bridgeInitialSemaphore(id node, SEL selector, int32_t capacity);
void bridgeDeferredStartHook(id graph, SEL selector);
void bridgeDeferredPrepareHook(id graph, SEL selector, id handler);
BOOL bridgeGraphStop(id graph, SEL selector, void *error);
void bridgeDevicePrepare(id device, SEL selector, id completion);
void bridgeStreamPrepareStill(id stream, SEL selector, id settings);
void bridgeTimeMachineRender(id node, SEL selector, CMSampleBufferRef sample, id input);
void bridgeTimeMachineHandle(id node, SEL selector, CMSampleBufferRef sample);
BOOL bridgeTimeMachineComplete(id node, SEL selector);
void bridgeOutputEmit(id output, SEL selector, CMSampleBufferRef sample);
void bridgeCoordinatorRender(id node, SEL selector, CMSampleBufferRef sample, id input);
void bridgeGNRRender(id node, SEL selector, CMSampleBufferRef sample, id input);
void fetchAudio(void);
void bridgeMovieSinkRender(id node, SEL selector, CMSampleBufferRef sample, id input);
void bridgeCompressorRender(id node, SEL selector, CMSampleBufferRef sample, id input);
void bridgeQueueSinkRender(id node, SEL selector, CMSampleBufferRef sample, id input);

#pragma GCC visibility pop
