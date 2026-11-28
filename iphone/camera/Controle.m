#import "Ponte.h"

static NSString *const kControl = @"/var/tmp/obs-graph-bridge-control.json";
NSString *const kCameraApp = @"com.apple.camera";
NSSet<NSString *> *g_allowedAppIDs;
BOOL g_enabled;
BOOL g_previewOnly;
BOOL g_continuous;
BOOL g_directRecording;
BOOL g_videoInjection;
BOOL g_audioInjection;
BOOL g_photoPrepareBypass;
int g_frameRate = 5;
NSTimeInterval g_expires;
NSString *g_url;
NSString *g_socket;
NSString *g_remoteQueuePortType;

BOOL leaseValid(void) {
    return g_enabled && !g_faulted && (g_continuous || [[NSDate date] timeIntervalSince1970] < g_expires);
}

static BOOL isHexTokenPath(NSString *path) {
    const NSUInteger expected = 3 + 32 + 10;
    if (![path isKindOfClass:[NSString class]] || path.length != expected) return NO;
    if (![path hasPrefix:@"/s/"] || ![path hasSuffix:@"/frame.jpg"]) return NO;
    for (NSUInteger i = 3; i < 35; i++) {
        unichar c = [path characterAtIndex:i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return NO;
    }
    return YES;
}

static BOOL isCameraSocketPath(NSString *path) {
    if (![path isKindOfClass:[NSString class]] || path.length < 12 || path.length > 96) return NO;
    if (![path hasPrefix:@"/var/tmp/"] && ![path hasPrefix:@"/var/run/"]) return NO;
    if ([path containsString:@".."] || [path containsString:@"//"]) return NO;
    return YES;
}

NSData *httpGetOverUnix(NSString *socketPath, NSString *requestPath, NSTimeInterval timeout, NSUInteger maxBytes) {
    if (!isCameraSocketPath(socketPath) || requestPath.length == 0 || requestPath.length > 256) return nil;
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return nil;
    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    if (strlcpy(address.sun_path, socketPath.UTF8String, sizeof(address.sun_path)) >= sizeof(address.sun_path)) {
        close(fd);
        return nil;
    }
    struct timeval tv;
    tv.tv_sec = (time_t)timeout;
    tv.tv_usec = (suseconds_t)((timeout - (NSTimeInterval)tv.tv_sec) * 1000000.0);
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    NSData *result = nil;
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0) {
        NSString *request = [NSString stringWithFormat:@"GET %@ HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n", requestPath];
        NSData *payload = [request dataUsingEncoding:NSUTF8StringEncoding];
        if (payload.length && send(fd, payload.bytes, payload.length, 0) == (ssize_t)payload.length) {
            NSMutableData *response = [NSMutableData data];
            uint8_t buffer[8192];
            while (response.length <= maxBytes + 4096) {
                ssize_t received = recv(fd, buffer, sizeof(buffer), 0);
                if (received <= 0) break;
                [response appendBytes:buffer length:(NSUInteger)received];
            }
            NSRange separator = [response rangeOfData:[@"\r\n\r\n" dataUsingEncoding:NSUTF8StringEncoding]
                                              options:0 range:NSMakeRange(0, MIN(response.length, (NSUInteger)4096))];
            if (separator.location != NSNotFound) {
                NSString *head = [[NSString alloc] initWithData:[response subdataWithRange:NSMakeRange(0, separator.location)]
                                                       encoding:NSUTF8StringEncoding];
                if ([head hasPrefix:@"HTTP/1.0 200"] || [head hasPrefix:@"HTTP/1.1 200"]) {
                    NSUInteger start = NSMaxRange(separator);
                    NSData *body = [response subdataWithRange:NSMakeRange(start, response.length - start)];
                    if (body.length <= maxBytes) result = body;
                }
            }
        }
    }
    close(fd);
    return result;
}

BOOL appAllowed(id appID) {
    [g_lock lock];
    BOOL allowed = [appID isKindOfClass:[NSString class]] &&
        ([g_allowedAppIDs containsObject:appID] || [g_allowedAppIDs containsObject:@"*"]);
    [g_lock unlock];
    return allowed;
}

void readControl(void) {
    NSData *data = [NSData dataWithContentsOfFile:kControl];
    id parsed = data.length > 0 && data.length <= 2048
        ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    NSDictionary *config = [parsed isKindOfClass:[NSDictionary class]] ? parsed : nil;
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    id expiry = [config isKindOfClass:[NSDictionary class]] ? config[@"expiresAt"] : nil;
    id address = [config isKindOfClass:[NSDictionary class]] ? config[@"url"] : nil;
    NSURL *url = [address isKindOfClass:[NSString class]] ? [NSURL URLWithString:address] : nil;
    BOOL continuous = [config[@"continuous"] isEqual:@YES];
    NSArray *requestedApps = [config[@"appIDs"] isKindOfClass:[NSArray class]] ? config[@"appIDs"] : nil;
    NSMutableSet<NSString *> *allowedApps = [NSMutableSet set];
    if (requestedApps && requestedApps.count > 0 && requestedApps.count <= 16) {
        for (id item in requestedApps)
            if ([item isKindOfClass:[NSString class]] && [item length] > 0 && [item length] < 128)
                [allowedApps addObject:item];
    } else if ([config[@"appID"] isEqual:kCameraApp]) {
        [allowedApps addObject:kCameraApp];
    }
    NSString *socketPath = [config[@"socket"] isKindOfClass:[NSString class]] ? config[@"socket"] : nil;
    BOOL unixTransport = isCameraSocketPath(socketPath);
    NSInteger port = [url.port integerValue];
    BOOL tcpTransport = [url.host isEqualToString:@"127.0.0.1"] && port >= 1024 && port <= 65535;
    BOOL valid = [config[@"mode"] isEqual:@"inject"] && allowedApps.count > 0 &&
        [expiry isKindOfClass:[NSNumber class]] && [url.scheme isEqualToString:@"http"] &&
        isHexTokenPath(url.path) && (unixTransport || tcpTransport) &&
        (continuous || ([expiry doubleValue] > now && [expiry doubleValue] <= now+120));
    [g_lock lock];
    g_enabled = valid;
    g_allowedAppIDs = valid ? [allowedApps copy] : [NSSet set];
    g_continuous = valid && continuous;
    g_directRecording = valid && [config[@"directRecording"] isEqual:@YES];
    g_videoInjection = valid && [config[@"videoInjection"] isEqual:@YES];
    g_audioInjection = valid && [config[@"audioInjection"] isEqual:@YES];
    if (!g_audioInjection) { [g_audioPackets removeAllObjects]; g_audioSequence = 0; }
    g_photoPrepareBypass = valid && [config[@"photoPrepareBypass"] isEqual:@YES];
    if (!g_photoPrepareBypass)
        for (OBSBridgeContext *ctx in g_contexts.allValues) {
            ctx.pendingPhotoSettings = nil;
            ctx.pendingPhotoStream = nil;
        }
    id rate = config[@"frameRate"];
    g_frameRate = [rate isKindOfClass:[NSNumber class]] ? MAX(1, MIN(30, [rate intValue])) : 5;
    g_previewOnly = valid && [config[@"previewOnly"] isEqual:@YES];
    id portOverride = config[@"remoteQueuePortType"];
    NSString *portType = nil;
    if ([portOverride isKindOfClass:[NSString class]] && [portOverride length] > 0 && [portOverride length] <= 64)
        portType = portOverride;
    g_remoteQueuePortType = valid ? (portType ?: @"PortTypeBack") : nil;
    g_expires = valid ? [expiry doubleValue] : 0;
    g_url = valid ? [address copy] : nil;
    g_socket = (valid && unixTransport) ? [socketPath copy] : nil;
    [g_lock unlock];
}
