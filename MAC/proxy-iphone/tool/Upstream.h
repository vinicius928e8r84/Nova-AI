#import <Foundation/Foundation.h>

int upstream_connect(const char *scheme,
                     const char *proxy_host, int proxy_port,
                     const char *user, const char *pass,
                     const char *target_host, int target_port,
                     char *err, size_t errlen);
