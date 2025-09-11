import IORedis, {Redis} from 'ioredis'
import { REDIS_URL, NODE_ENV } from './env'
import logger from '../utils/logger'
import type { RedisOptions } from 'ioredis'

const RedisOptions:RedisOptions={
 //Connection settings
 connectTimeout:1000,
 lazyConnect:true,
 keepAlive:3000,
 // Retry strategy with exponential backoff
  retryDelayOnFailover: 100,
  maxLoadingRetryTime:3,
  retryStrategy:(times:number):number | null =>{
    const delay = Math.min(times * 50,2000);
    if(times>10){
        logger.error(`Redis retry attemps exceeded:${times}`);
        return null;
    }
    return delay;
  },
  //Production optimizations
maxLoadingTimeout: 5000,
  enableReadyCheck: true,
  maxRetriesPerRequest: NODE_ENV === 'production' ? 3 : null,
  // Connection pool settings
  tls: {},
  family: 4, // IPv4
  compression:'gzip',
} as RedisOptions& Record<string,any>

export const redis:Redis = new IORedis(REDIS_URL,RedisOptions);


let isConnected = false;
let isReconnecting = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 10;


//ENhanced event handlers

redis.on('connect',() =>{
   connectionAttempts=0;
   isReconnecting=false;
   logger.info('Redis connection established',{
    host:redis.options.host,
    port: redis.options.port,
    db: redis.options.db || 0,
   })
})

redis.on('error',(error:Error) =>{
    isConnected=false;
    logger.error('Redis connection error:',{
        message:error.message,
        code:(error as any).code,
        errno:(error as any).errno,
        syncall:(error as any).syncall,
        stack:NODE_ENV==='development'?error.stack:undefined,
    })
})

redis.on('close',() =>{
    isConnected = false,
    logger.warn('Redis connected closed');
})

redis.on('reconnecting',(ms:number) =>{
    isReconnecting = true;
    connectionAttempts++;

    if(connectionAttempts>= MAX_CONNECTION_ATTEMPTS){
logger.error('Max Redis reconnection attempts reaced, stopping...')
redis.disconnect(false);
return;
    }

    logger.info('Attempting Redis reconnection',{
        attempt: connectionAttempts,
    delayMs: ms,
    maxAttempts: MAX_CONNECTION_ATTEMPTS,
    })
})

redis.on('end', () => {
  isConnected = false;
  logger.info('Redis connection ended');
});