#import <Foundation/Foundation.h>

@interface ProxyConfig : NSObject

@property (nonatomic, copy) NSString *scheme;
@property (nonatomic, copy) NSString *host;
@property (nonatomic, assign) int port;
@property (nonatomic, copy) NSString *user;
@property (nonatomic, copy) NSString *pass;
@property (nonatomic, assign) int localPort;
@property (nonatomic, assign) BOOL schemeGuessed;

+ (instancetype)parse:(NSString *)raw error:(NSString **)error;

+ (NSString *)configPath;

+ (instancetype)load;
- (BOOL)save:(NSString **)error;
@end
