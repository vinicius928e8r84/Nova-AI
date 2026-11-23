#pragma once
#import <Foundation/Foundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>
#import <TargetConditionals.h>
#if TARGET_OS_IPHONE
#import <IOSurface/IOSurfaceRef.h>
#import <CoreVideo/CVPixelBufferIOSurface.h>
#else
#import <IOSurface/IOSurface.h>
#endif

static BOOL VCPInjectionAllowed(id parsed, NSString *session, NSTimeInterval now) {
    if (![parsed isKindOfClass:[NSDictionary class]]) return NO;
    NSDictionary *config = parsed;
    id mode = config[@"mode"], instance = config[@"session"], expiry = config[@"expiresAt"];
    id address = config[@"url"] ?: @"http://10.0.0.245:8900/frame.jpg";
    id angle = config[@"rotation"] ?: @0;
    if (![mode isKindOfClass:[NSString class]] || ![mode isEqual:@"inject"] ||
        ![instance isKindOfClass:[NSString class]] || ![instance isEqual:session] ||
        ![expiry isKindOfClass:[NSNumber class]] || ![address isKindOfClass:[NSString class]] ||
        ![angle isKindOfClass:[NSNumber class]]) return NO;
    double expires = [expiry doubleValue], rotation = [angle doubleValue];
    NSURL *url = [NSURL URLWithString:address];
    return isfinite(expires) && expires > now && expires <= now+600 &&
        [url.scheme isEqual:@"http"] && url.host.length &&
        (rotation == 0 || rotation == 90 || rotation == 180 || rotation == 270);
}

static BOOL VCPFormatSupported(OSType fmt) {
    return fmt == kCVPixelFormatType_32BGRA || fmt == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange ||
           fmt == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
}

static CGColorSpaceRef VCPCopyColorSpace(CVPixelBufferRef buffer) {
    NSDictionary *a = CFBridgingRelease(CVBufferCopyAttachments(buffer, kCVAttachmentMode_ShouldPropagate));
    id transfer = a[(id)kCVImageBufferTransferFunctionKey];
    if ([transfer isEqual:(id)kCVImageBufferTransferFunction_SMPTE_ST_2084_PQ] ||
        [transfer isEqual:(id)kCVImageBufferTransferFunction_ITU_R_2100_HLG]) return NULL;
    CGColorSpaceRef space = (__bridge CGColorSpaceRef)a[(id)kCVImageBufferCGColorSpaceKey];
    if (space && CFGetTypeID(space) != CGColorSpaceGetTypeID()) return NULL;
    space = space ? CGColorSpaceRetain(space) : (a ? CVImageBufferCreateColorSpaceFromAttachments((__bridge CFDictionaryRef)a) : NULL);
    if (space && CGColorSpaceGetModel(space) != kCGColorSpaceModelRGB) {
        CGColorSpaceRelease(space); return NULL;
    }
    return space;
}

static size_t VCPRowAlignment(CVPixelBufferRef buffer) {
    if (!buffer) return 0;
    size_t stride = CVPixelBufferIsPlanar(buffer) ? CVPixelBufferGetBytesPerRowOfPlane(buffer, 0) : CVPixelBufferGetBytesPerRow(buffer);
    return stride & (~stride + 1);
}

static BOOL VCPShouldPrepareStill(double lastStill, double lastVideo, double now) {
    return lastStill > 0 && (now-lastStill < 5.0 || (lastVideo > 0 && now-lastVideo < 1.0));
}

static NSArray<NSString *> *VCPFormatMismatchKeys(CMVideoFormatDescriptionRef fd, CVPixelBufferRef buffer) {
    if (!fd || !buffer) return @[@"missingFormatOrBuffer"];
    NSMutableArray *different = [NSMutableArray array];
    NSArray *keys = (__bridge NSArray *)CMVideoFormatDescriptionGetExtensionKeysCommonWithImageBuffers();
    for (NSString *key in keys) {
        CFTypeRef expected = CMFormatDescriptionGetExtension(fd, (__bridge CFStringRef)key);
        CFTypeRef actual = CVBufferCopyAttachment(buffer, (__bridge CFStringRef)key, NULL);
        if ((expected && !actual) || (!expected && actual) || (expected && actual && !CFEqual(expected, actual)))
            [different addObject:key];
        if (actual) CFRelease(actual);
    }
    NSNumber *row = (__bridge NSNumber *)CMFormatDescriptionGetExtension(fd, kCMFormatDescriptionExtension_BytesPerRow);
    if (row && row.unsignedLongLongValue != CVPixelBufferGetBytesPerRow(buffer)) [different addObject:@"BytesPerRow"];
    return different;
}

static void VCPDrawFrame(CGImageRef frame, CIContext *context, CVPixelBufferRef out,
                         size_t w, size_t h, CGColorSpaceRef space, int rotation) {
    OSType fmt = out ? CVPixelBufferGetPixelFormatType(out) : 0;
    if (!frame || !context || !space || !VCPFormatSupported(fmt) || w < 2 || h < 2 ||
        w > 8192 || h > 8192 || (fmt != kCVPixelFormatType_32BGRA && ((w % 2) || (h % 2)))) return;
    if (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270) return;
    CIImage *image = [CIImage imageWithCGImage:frame];
    CGImagePropertyOrientation orientation = rotation == 90 ? kCGImagePropertyOrientationRight :
        rotation == 180 ? kCGImagePropertyOrientationDown : rotation == 270 ? kCGImagePropertyOrientationLeft : kCGImagePropertyOrientationUp;
    image = [image imageByApplyingCGOrientation:orientation];
    CGRect e = image.extent;
    image = [image imageByApplyingTransform:CGAffineTransformMakeTranslation(-e.origin.x, -e.origin.y)];
    CGFloat scale = MAX(w / e.size.width, h / e.size.height);
    image = [image imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
    e = image.extent;
    image = [image imageByApplyingTransform:CGAffineTransformMakeTranslation((w-e.size.width)/2-e.origin.x, (h-e.size.height)/2-e.origin.y)];
    [context render:image toCVPixelBuffer:out bounds:CGRectMake(0, 0, w, h) colorSpace:space];
}

static CVPixelBufferRef VCPCopyRenderedBuffer(CGImageRef frame, CIContext *context,
    size_t w, size_t h, OSType fmt, CGColorSpaceRef space, NSDictionary *attachments, int rotation, size_t rowAlignment) {
    if (!frame || !context || !space || !VCPFormatSupported(fmt) || w < 2 || h < 2 ||
        w > 8192 || h > 8192 || (fmt != kCVPixelFormatType_32BGRA && ((w % 2) || (h % 2)))) return NULL;
    if (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270) return NULL;
    CVPixelBufferRef out = NULL;
    NSMutableDictionary *allocation = [@{(id)kCVPixelBufferIOSurfacePropertiesKey:@{}} mutableCopy];
    if (rowAlignment) allocation[(id)kCVPixelBufferBytesPerRowAlignmentKey] = @(rowAlignment);
    if (CVPixelBufferCreate(NULL, w, h, fmt, (__bridge CFDictionaryRef)allocation, &out) != kCVReturnSuccess) return NULL;
    if (attachments) CVBufferSetAttachments(out, (__bridge CFDictionaryRef)attachments, kCVAttachmentMode_ShouldPropagate);
    VCPDrawFrame(frame, context, out, w, h, space, rotation);
    return out;
}

static CVPixelBufferRef VCPCopyRenderedPlanarLayout(CGImageRef frame, CIContext *context,
    size_t w, size_t h, OSType fmt, CGColorSpaceRef space, NSDictionary *attachments,
    int rotation, size_t plane0Row, size_t plane1Row, size_t dataSize) {
    if (!frame || !context || !space ||
        (fmt != kCVPixelFormatType_420YpCbCr8BiPlanarFullRange &&
         fmt != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange) ||
        !w || !h || w > 8192 || h > 8192 || (w & 1) || (h & 1) ||
        plane0Row < w || plane1Row < w || plane0Row > 16384 || plane1Row > 16384 ||
        dataSize > 256*1024*1024 || dataSize < plane0Row*h + plane1Row*(h/2) ||
        dataSize % h ||
        (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270)) return NULL;
    NSDictionary *plane0 = @{
        (__bridge id)kIOSurfacePlaneWidth:@(w), (__bridge id)kIOSurfacePlaneHeight:@(h),
        (__bridge id)kIOSurfacePlaneBytesPerRow:@(plane0Row),
        (__bridge id)kIOSurfacePlaneOffset:@0, (__bridge id)kIOSurfacePlaneSize:@(plane0Row*h)};
    NSDictionary *plane1 = @{
        (__bridge id)kIOSurfacePlaneWidth:@(w/2), (__bridge id)kIOSurfacePlaneHeight:@(h/2),
        (__bridge id)kIOSurfacePlaneBytesPerRow:@(plane1Row),
        (__bridge id)kIOSurfacePlaneOffset:@(plane0Row*h),
        (__bridge id)kIOSurfacePlaneSize:@(plane1Row*(h/2))};
    NSDictionary *properties = @{
        (__bridge id)kIOSurfaceWidth:@(w), (__bridge id)kIOSurfaceHeight:@(h),
        (__bridge id)kIOSurfacePixelFormat:@(fmt),
        (__bridge id)kIOSurfaceAllocSize:@(dataSize),
        (__bridge id)kIOSurfaceBytesPerRow:@(dataSize/h),
        (__bridge id)kIOSurfacePlaneInfo:@[plane0, plane1]};
    IOSurfaceRef surface = IOSurfaceCreate((__bridge CFDictionaryRef)properties);
    if (!surface) return NULL;
    CVPixelBufferRef out = NULL;
    CVReturn rc = CVPixelBufferCreateWithIOSurface(NULL, surface, NULL, &out);
    CFRelease(surface);
    if (rc != kCVReturnSuccess || !out) return NULL;
    if (attachments) CVBufferSetAttachments(out, (__bridge CFDictionaryRef)attachments, kCVAttachmentMode_ShouldPropagate);
    VCPDrawFrame(frame, context, out, w, h, space, rotation);
    return out;
}

typedef NS_ENUM(NSInteger, VCPReplacementResult) {
    VCPInvalidSample, VCPUnsupportedBuffer, VCPDimensionMismatch,
    VCPFormatMismatch, VCPTimingError, VCPAssemblyError, VCPReplaced
};
static NSString *VCPResultName(VCPReplacementResult result) {
    switch (result) {
        case VCPInvalidSample: return @"invalidSample";
        case VCPUnsupportedBuffer: return @"unsupportedBuffer";
        case VCPDimensionMismatch: return @"dimensionMismatch";
        case VCPFormatMismatch: return @"formatMismatch";
        case VCPTimingError: return @"timingError";
        case VCPAssemblyError: return @"assemblyError";
        case VCPReplaced: return @"replaced";
    }
    return @"unknown";
}
static CMSampleBufferRef VCPCopyReplacement(CMSampleBufferRef original, CVPixelBufferRef pixels,
                                            VCPReplacementResult *result) {
    if (result) *result = VCPInvalidSample;
    if (!original || !pixels || !CMSampleBufferDataIsReady(original) || CMSampleBufferGetNumSamples(original) != 1) return NULL;
    CVPixelBufferRef native = CMSampleBufferGetImageBuffer(original);
    if (result) *result = VCPUnsupportedBuffer;
    if (!native || !VCPFormatSupported(CVPixelBufferGetPixelFormatType(native)) ||
        CVPixelBufferGetPixelFormatType(native) != CVPixelBufferGetPixelFormatType(pixels)) return NULL;
    if (result) *result = VCPDimensionMismatch;
    if (CVPixelBufferGetWidth(native) != CVPixelBufferGetWidth(pixels) ||
        CVPixelBufferGetHeight(native) != CVPixelBufferGetHeight(pixels)) return NULL;
    if (result) *result = VCPFormatMismatch;
    CMFormatDescriptionRef fd = CMSampleBufferGetFormatDescription(original);
    if (!fd || CMFormatDescriptionGetMediaType(fd) != kCMMediaType_Video ||
        !CMVideoFormatDescriptionMatchesImageBuffer(fd, pixels)) return NULL;
    if (result) *result = VCPTimingError;
    CMSampleTimingInfo timing;
    if (CMSampleBufferGetSampleTimingInfo(original, 0, &timing) != noErr) return NULL;
    if (result) *result = VCPAssemblyError;
    CMSampleBufferRef out = NULL;
    if (CMSampleBufferCreateReadyWithImageBuffer(NULL, pixels, fd, &timing, &out) != noErr) return NULL;
    for (NSNumber *mode in @[@(kCMAttachmentMode_ShouldPropagate), @(kCMAttachmentMode_ShouldNotPropagate)]) {
        CFDictionaryRef a = CMCopyDictionaryOfAttachments(NULL, original, mode.intValue);
        if (a) { CMSetAttachments(out, a, mode.intValue); CFRelease(a); }
    }
    CFArrayRef from = CMSampleBufferGetSampleAttachmentsArray(original, false);
    if (from && CFArrayGetCount(from)) {
        CFArrayRef to = CMSampleBufferGetSampleAttachmentsArray(out, true);
        if (to && CFArrayGetCount(to)) {
            NSDictionary *a = (__bridge NSDictionary *)CFArrayGetValueAtIndex(from, 0);
            NSMutableDictionary *b = (__bridge NSMutableDictionary *)CFArrayGetValueAtIndex(to, 0);
            [b addEntriesFromDictionary:a];
        }
    }
    if (result) *result = VCPReplaced;
    return out;
}

static CVPixelBufferRef VCPCopyColdStill(CMSampleBufferRef sample, CGImageRef frame, CIContext *context, int rotation) {
    if (!sample || !frame || !context) return NULL;
    CVPixelBufferRef native = CMSampleBufferGetImageBuffer(sample);
    if (!native || !VCPFormatSupported(CVPixelBufferGetPixelFormatType(native))) return NULL;
    CGColorSpaceRef space = VCPCopyColorSpace(native);
    if (!space) return NULL;
    NSDictionary *attachments = CFBridgingRelease(CVBufferCopyAttachments(native, kCVAttachmentMode_ShouldPropagate));
    CVPixelBufferRef pixels = VCPCopyRenderedBuffer(frame, context, CVPixelBufferGetWidth(native),
        CVPixelBufferGetHeight(native), CVPixelBufferGetPixelFormatType(native), space, attachments,
        rotation, VCPRowAlignment(native));
    CGColorSpaceRelease(space);
    return pixels;
}
