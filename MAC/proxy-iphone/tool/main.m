#import <Foundation/Foundation.h>
#import "ProxyConfig.h"
#import "SysProxy.h"
#import "Forwarder.h"
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <errno.h>
#include <spawn.h>
#include <sys/wait.h>
#include <dlfcn.h>
#include <CoreFoundation/CoreFoundation.h>

static const char *kLaunchctl = "/var/jb/usr/bin/launchctl";
static const char *kJob = "system/com.aquiles.novaproxy";
static const char *kPlist = "/var/jb/Library/LaunchDaemons/com.aquiles.novaproxy.plist";


// Lê se o Wi-Fi está ligado (MobileWiFi). -1 = não consegui ler.
static int wifi_power(void) {
    void *h = dlopen("/System/Library/PrivateFrameworks/MobileWiFi.framework/MobileWiFi", RTLD_LAZY);
    if (!h) return -1;
    typedef void *(*CreateFn)(CFAllocatorRef, void *);
    typedef int (*GetFn)(void *, Boolean *);
    typedef void (*SchedFn)(void *, CFRunLoopRef, CFStringRef);
    CreateFn create = (CreateFn)dlsym(h, "WiFiManagerClientCreate");
    GetFn get = (GetFn)dlsym(h, "WiFiManagerClientGetPower");
    SchedFn sched = (SchedFn)dlsym(h, "WiFiManagerClientScheduleWithRunLoop");
    if (!create || !get) return -1;
    void *client = create(kCFAllocatorDefault, NULL);
    if (!client) return -1;
    if (sched) sched(client, CFRunLoopGetCurrent(), kCFRunLoopCommonModes);
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.3, false);
    Boolean on = NO;
    get(client, &on);
    return on ? 1 : 0;
}

static int port_open(int port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return 0;
    struct timeval tv = { .tv_sec = 1, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_port = htons((uint16_t)port);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int ok = connect(fd, (struct sockaddr *)&a, sizeof(a)) == 0;
    close(fd);
    return ok;
}

extern char **environ;

static int run_cmd(const char *path, char *const argv[]) {
    pid_t pid = 0;
    int status = 0;
    if (posix_spawn(&pid, path, NULL, NULL, argv, environ) != 0) return -1;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static void restart_daemon(int port) {
    char *kick[] = { (char *)kLaunchctl, "kickstart", "-k", (char *)kJob, NULL };
    run_cmd(kLaunchctl, kick);
    for (int i = 0; i < 30 && !port_open(port); i++) usleep(100000);
    if (!port_open(port)) {
        char *boot[] = { (char *)kLaunchctl, "bootstrap", "system", (char *)kPlist, NULL };
        run_cmd(kLaunchctl, boot);
        for (int i = 0; i < 30 && !port_open(port); i++) usleep(100000);
    }
}

static NSString *proxyLabel(NSDictionary *p) {
    if (![p isKindOfClass:[NSDictionary class]]) return @"off";
    if ([p[@"HTTPEnable"] intValue] == 0) return @"off";
    NSString *host = p[@"HTTPProxy"];
    if (![host isKindOfClass:[NSString class]] || host.length == 0) return @"off";
    return [NSString stringWithFormat:@"on %@:%@", host, p[@"HTTPPort"] ?: @"?"];
}

static int cmd_status(void) {
    ProxyConfig *cfg = [ProxyConfig load];
    NSDictionary *p = SysProxyCurrent();
    NSString *state = proxyLabel(p);
    int daemon = cfg ? port_open(cfg.localPort) : 0;
    NSString *upstream = cfg ? [NSString stringWithFormat:@"%@:%d", cfg.host, cfg.port] : @"-";
    int wifi = wifi_power();
    printf("%s local=%d upstream=%s daemon=%s wifi=%s uid=%d\n",
           state.UTF8String,
           cfg ? cfg.localPort : 8899,
           upstream.UTF8String,
           daemon ? "running" : "stopped",
           wifi == 1 ? "on" : (wifi == 0 ? "off" : "unknown"), geteuid());
    return 0;
}

static int cmd_set(NSString *raw) {
    NSString *err = nil;
    ProxyConfig *cfg = [ProxyConfig parse:raw error:&err];
    if (!cfg) {
        fprintf(stderr, "erro: %s\n", err.UTF8String ?: "proxy inválido");
        return 2;
    }
    if (![cfg save:&err]) {
        fprintf(stderr, "erro: %s\n", err.UTF8String);
        return 2;
    }

    restart_daemon(cfg.localPort);
    if (!port_open(cfg.localPort)) {
        fprintf(stderr, "erro: o proxy local não subiu em 127.0.0.1:%d (veja /var/jb/var/log/novaproxy.log)\n", cfg.localPort);
        return 3;
    }

    if (!SysProxyApply(@"127.0.0.1", cfg.localPort, &err)) {
        fprintf(stderr, "erro ao aplicar no Wi-Fi: %s\n", err.UTF8String);
        return 4;
    }

    int wifi = wifi_power();
    printf("ok %s:%d via 127.0.0.1:%d wifi=%s\n", cfg.host.UTF8String, cfg.port, cfg.localPort,
           wifi == 1 ? "on" : (wifi == 0 ? "off" : "unknown"));
    if (wifi == 0) fprintf(stderr, "aviso: Wi-Fi desligado no momento\n");
    return 0;
}

static int cmd_clear(void) {
    NSString *err = nil;
    if (!SysProxyClear(&err)) {
        fprintf(stderr, "erro: %s\n", err.UTF8String);
        return 4;
    }
    printf("ok cleared\n");
    return 0;
}

static int cmd_check(int useSystem) {
    ProxyConfig *cfg = [ProxyConfig load];
    int port = cfg ? cfg.localPort : 8899;
    if (!port_open(port)) {
        fprintf(stderr, "erro: proxy local não está escutando em 127.0.0.1:%d\n", port);
        return 3;
    }

    NSDictionary *proxy = @{
        @"HTTPEnable": @1, @"HTTPProxy": @"127.0.0.1", @"HTTPPort": @(port),
        @"HTTPSEnable": @1, @"HTTPSProxy": @"127.0.0.1", @"HTTPSPort": @(port),
    };
    NSURLSessionConfiguration *conf = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    if (!useSystem) conf.connectionProxyDictionary = proxy;
    conf.timeoutIntervalForRequest = 20;
    conf.timeoutIntervalForResource = 25;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:conf];

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSString *body = nil;
    __block NSString *error = nil;
    NSURL *url = [NSURL URLWithString:@"https://api.ipify.org"];
    [[session dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *resp, NSError *e) {
        if (e) error = e.localizedDescription;
        else body = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        dispatch_semaphore_signal(sem);
    }] resume];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    [session invalidateAndCancel];

    if (error || body.length == 0) {
        fprintf(stderr, "erro: %s\n", error.UTF8String ?: "sem resposta");
        return 5;
    }
    printf("%s\n", [body stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]].UTF8String);
    return 0;
}

static void usage(void) {
    fprintf(stderr,
            "uso:\n"
            "  novaproxy proxy set <socks5://host:porta:usuario:senha>\n"
            "  novaproxy proxy clear\n"
            "  novaproxy proxy status\n"
            "  novaproxy proxy check [system]\n"
            "  novaproxy proxyd            (daemon, roda pelo launchd)\n");
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc >= 2 && strcmp(argv[1], "proxyd") == 0) {
            ProxyConfig *cfg = nil;
            int waits = 0;
            while (!(cfg = [ProxyConfig load])) {
                if (waits++ % 12 == 0) fprintf(stderr, "[novaproxy] aguardando configuração...\n");
                sleep(5);
            }
            return run_forwarder(cfg);
        }
        if (argc >= 3 && strcmp(argv[1], "proxy") == 0) {
            NSString *sub = [NSString stringWithUTF8String:argv[2]];
            if ([sub isEqualToString:@"set"]) {
                if (argc < 4) { usage(); return 1; }
                return cmd_set([NSString stringWithUTF8String:argv[3]]);
            }
            if ([sub isEqualToString:@"clear"]) return cmd_clear();
            if ([sub isEqualToString:@"status"]) return cmd_status();
            if ([sub isEqualToString:@"check"]) return cmd_check(argc >= 4 && strcmp(argv[3], "system") == 0);
        }
        usage();
        return 1;
    }
}
