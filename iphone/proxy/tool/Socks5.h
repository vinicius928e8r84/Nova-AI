#import <Foundation/Foundation.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

int socks5_connect(const char *proxy_host, int proxy_port,
                   const char *user, const char *pass,
                   const char *target_host, int target_port,
                   char *err, size_t errlen);
