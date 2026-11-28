#import "Ponte.h"

BOOL hasABI(Class cls, const char *name, const char *expected) {
    Method method = cls ? class_getInstanceMethod(cls, sel_registerName(name)) : NULL;
    return method && !strcmp(method_getTypeEncoding(method), expected);
}

id getObject(id object, const char *name) {
    if (!object) return nil;
    SEL selector = sel_registerName(name);
    Method method = class_getInstanceMethod(object_getClass(object), selector);
    if (!method || method_getNumberOfArguments(method) != 2) return nil;
    char type[8] = {0}; method_getReturnType(method, type, sizeof(type));
    if (type[0] != '@') return nil;
    @try { return ((id (*)(id, SEL))objc_msgSend)(object, selector); }
    @catch (NSException *exception) { return nil; }
}

id numericGetter(id object, const char *name) {
    Method method = object ? class_getInstanceMethod(object_getClass(object), sel_registerName(name)) : NULL;
    if (!method || method_getNumberOfArguments(method) != 2) return [NSNull null];
    char type[8] = {0}; method_getReturnType(method, type, sizeof(type));
    if (type[0] == 'i' || type[0] == 'I')
        return @(((int (*)(id, SEL))objc_msgSend)(object, sel_registerName(name)));
    if (type[0] == 'q' || type[0] == 'Q')
        return @(((long long (*)(id, SEL))objc_msgSend)(object, sel_registerName(name)));
    return [NSNull null];
}

id ivarObject(id object, const char *name) {
    Ivar ivar = object ? class_getInstanceVariable(object_getClass(object), name) : NULL;
    if (!ivar || ivar_getTypeEncoding(ivar)[0] != '@') return nil;
    return object_getIvar(object, ivar);
}

id ivarNumber(id object, const char *name) {
    Ivar ivar = object ? class_getInstanceVariable(object_getClass(object), name) : NULL;
    if (!ivar) return [NSNull null];
    const char *type = ivar_getTypeEncoding(ivar);
    const uint8_t *location = (const uint8_t *)(__bridge const void *)object + ivar_getOffset(ivar);
    if (type[0] == 'B') return @(*location != 0);
    if (type[0] == 'i' || type[0] == 'I') {
        int32_t value;
        memcpy(&value, location, sizeof(value));
        return @(value);
    }
    return [NSNull null];
}

NSString *roleForOutput(id physical, id output) {
    if (getObject(physical, "videoCaptureOutput") == output) return @"video";
    if (getObject(physical, "stillImageOutput") == output) return @"still";
    if (getObject(physical, "detectedObjectsOutput") == output) return @"metadata";
    return nil;
}
