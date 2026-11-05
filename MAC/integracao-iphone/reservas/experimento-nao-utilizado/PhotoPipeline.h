// Photo helpers shared with the host validation program. ImageIO still re-encodes
// the result; matching the original camera bitstream is not guaranteed.
#import <Foundation/Foundation.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>

static CIContext *g_ci;
static CGColorSpaceRef g_cs;
static void ensureCI() {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        g_ci = [CIContext contextWithOptions:nil];
        g_cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    });
}

static CIImage *fitImage(CGImageRef cg, CGFloat tw, CGFloat th) {
    CIImage *img = [CIImage imageWithCGImage:cg];
    CGRect e = img.extent;
    if (e.size.width <= 0 || e.size.height <= 0) return nil;
    CGFloat s = MAX(tw / e.size.width, th / e.size.height);
    img = [img imageByApplyingTransform:CGAffineTransformMakeScale(s, s)];
    e = img.extent;
    img = [img imageByApplyingTransform:CGAffineTransformMakeTranslation(
               (tw - e.size.width) / 2 - e.origin.x, (th - e.size.height) / 2 - e.origin.y)];
    return [img imageByCroppingToRect:CGRectMake(0, 0, tw, th)];
}

static CGImagePropertyOrientation orientationFrom(NSDictionary *meta) {
    int v = [meta[(id)kCGImagePropertyOrientation] intValue];
    return (v >= 1 && v <= 8) ? (CGImagePropertyOrientation)v : kCGImagePropertyOrientationUp;
}

static CGImagePropertyOrientation inverseOrientation(CGImagePropertyOrientation o) {
    if (o == kCGImagePropertyOrientationRight) return kCGImagePropertyOrientationLeft;
    if (o == kCGImagePropertyOrientationLeft) return kCGImagePropertyOrientationRight;
    return o;
}

static CGImageRef copyOBSSensorImage(CGImageRef frame, size_t pw, size_t ph,
                                    CGImagePropertyOrientation orient, CGColorSpaceRef space) {
    if (!frame || !space || !pw || !ph) return NULL;
    ensureCI();
    BOOL swap = orient >= kCGImagePropertyOrientationLeftMirrored;
    CIImage *img = fitImage(frame, swap ? ph : pw, swap ? pw : ph);
    if (!img) return NULL;
    CGImagePropertyOrientation inv = inverseOrientation(orient);
    if (inv != kCGImagePropertyOrientationUp) {
        img = [img imageByApplyingCGOrientation:inv];
        CGRect e = img.extent;
        img = [img imageByApplyingTransform:CGAffineTransformMakeTranslation(-e.origin.x, -e.origin.y)];
    }
    // Core Image converts the source colors into the output space. Changing only
    // a metadata label would reinterpret the values and give incorrect colors.
    return [g_ci createCGImage:img fromRect:CGRectMake(0, 0, pw, ph)
                        format:kCIFormatRGBA8 colorSpace:space];
}

static NSDictionary *photoProperties(NSDictionary *original) {
    // Only capture time and orientation describe this export. Exposure, lens,
    // face regions, GPS and opaque MakerNotes describe a different scene.
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    out[(id)kCGImagePropertyOrientation] = @(orientationFrom(original));
    NSDictionary *oldTIFF = original[(id)kCGImagePropertyTIFFDictionary];
    NSMutableDictionary *tiff = [NSMutableDictionary dictionary];
    if (oldTIFF[(id)kCGImagePropertyTIFFDateTime])
        tiff[(id)kCGImagePropertyTIFFDateTime] = oldTIFF[(id)kCGImagePropertyTIFFDateTime];
    tiff[(id)kCGImagePropertyTIFFSoftware] = @"VCamCaptura 0.1-3 (ImageIO)";
    out[(id)kCGImagePropertyTIFFDictionary] = tiff;
    NSDictionary *oldExif = original[(id)kCGImagePropertyExifDictionary];
    NSMutableDictionary *exif = [NSMutableDictionary dictionary];
    for (NSString *key in @[@"DateTimeOriginal", @"DateTimeDigitized", @"SubsecTimeOriginal",
                            @"SubsecTimeDigitized", @"OffsetTime", @"OffsetTimeOriginal", @"OffsetTimeDigitized"])
        if (oldExif[key]) exif[key] = oldExif[key];
    if (exif.count) out[(id)kCGImagePropertyExifDictionary] = exif;
    // Explicit export quality, not an assertion about the native encoder.
    out[(id)kCGImageDestinationLossyCompressionQuality] = @0.92;
    out[(id)kCGImageDestinationEmbedThumbnail] = @YES;
    return out;
}

static NSData *renderOBSPhotoData(NSData *orig, CGImageRef frame) {
    if (!orig || !frame) return nil;
    CGImageSourceRef src = CGImageSourceCreateWithData((__bridge CFDataRef)orig, NULL);
    if (!src) return nil;
    CFStringRef type = CGImageSourceGetType(src);
    NSDictionary *props = (__bridge_transfer NSDictionary *)CGImageSourceCopyPropertiesAtIndex(src, 0, NULL);
    // Obtain the actual color space, rather than using the ProfileName string.
    CGImageRef native = CGImageSourceCreateImageAtIndex(src, 0,
        (__bridge CFDictionaryRef)@{(id)kCGImageSourceShouldCache: @NO});
    CGColorSpaceRef space = native ? CGImageGetColorSpace(native) : NULL;
    size_t pw = [props[(id)kCGImagePropertyPixelWidth] unsignedLongValue];
    size_t ph = [props[(id)kCGImagePropertyPixelHeight] unsignedLongValue];
    CGImageRef out = (type && props && space && CGColorSpaceGetModel(space) == kCGColorSpaceModelRGB)
        ? copyOBSSensorImage(frame, pw, ph, orientationFrom(props), space) : NULL;
    NSMutableData *data = [NSMutableData data];
    BOOL ok = NO;
    if (out) {
        CGImageDestinationRef dest = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, type, 1, NULL);
        if (dest) {
            CGImageDestinationAddImage(dest, out, (__bridge CFDictionaryRef)photoProperties(props));
            ok = CGImageDestinationFinalize(dest);
            CFRelease(dest);
        }
        CGImageRelease(out);
    }
    if (native) CGImageRelease(native);
    CFRelease(src);
    // No JPEG fallback: failure preserves the original format and original data.
    return (ok && data.length > 0) ? data : nil;
}
