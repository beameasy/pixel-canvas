import { Redis } from '@upstash/redis'

const getRedisConfig = () => {
  if (process.env.NODE_ENV === 'development') {
    console.log('🔵 Using DEV Redis configuration')
    if (!process.env.UPSTASH_REDIS_REST_DEV_URL || !process.env.UPSTASH_REDIS_REST_DEV_TOKEN) {
      throw new Error('Missing DEV Redis environment variables')
    }
    return {
      url: process.env.UPSTASH_REDIS_REST_DEV_URL,
      token: process.env.UPSTASH_REDIS_REST_DEV_TOKEN
    }
  }
  
  console.log('🔵 Using PROD Redis configuration')
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('Missing PROD Redis environment variables') 
  }
  return {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  }
}

const config = getRedisConfig()
console.log('🔵 Initializing Redis connection:', config.url)

// Create Redis instance with health check
export const redis = new Redis({
  url: config.url,
  token: config.token
})

// Admin management functions
export const adminUtils = {
  async addAdmin(walletAddress: string) {
    try {
      await redis.sadd('admins', walletAddress.toLowerCase())
      console.log('✅ Added admin:', walletAddress)
      return true
    } catch (error) {
      console.error('❌ Error adding admin:', error)
      return false
    }
  },

  async removeAdmin(walletAddress: string) {
    try {
      await redis.srem('admins', walletAddress.toLowerCase())
      console.log('✅ Removed admin:', walletAddress)
      return true
    } catch (error) {
      console.error('❌ Error removing admin:', error)
      return false
    }
  },

  async isAdmin(walletAddress: string) {
    try {
      return await redis.sismember('admins', walletAddress.toLowerCase())
    } catch (error) {
      console.error('❌ Error checking admin status:', error)
      return false
    }
  },

  async listAdmins() {
    try {
      return await redis.smembers('admins')
    } catch (error) {
      console.error('❌ Error listing admins:', error)
      return []
    }
  }
}

// Rate limiting utilities
export const rateLimit = {
  async increment(key: string, duration: number): Promise<number> {
    const requests = await redis.incr(key)
    if (requests === 1) {
      await redis.expire(key, duration)
    }
    return requests
  },

  async check(ip: string, type: string, limit: { points: number, duration: number }): Promise<boolean> {
    const key = `rate_limit:${type}:${ip}`
    try {
      const requests = await this.increment(key, limit.duration)
      return requests <= limit.points
    } catch (error) {
      console.error('❌ Rate limit error:', error)
      return true // Fail open
    }
  },

  async reset(ip: string, type: string): Promise<void> {
    const key = `rate_limit:${type}:${ip}`
    await redis.del(key)
  }
}

// Ban management utilities
export const banUtils = {
  async banWallet(walletAddress: string, duration?: number) {
    try {
      const key = duration ? 'banned:wallets:temporary' : 'banned:wallets:permanent'
      await redis.sadd(key, walletAddress.toLowerCase())
      if (duration) {
        await redis.expire(`${key}:${walletAddress}`, duration)
      }
      console.log(`✅ Banned wallet ${duration ? 'temporarily' : 'permanently'}:`, walletAddress)
      return true
    } catch (error) {
      console.error('❌ Error banning wallet:', error)
      return false
    }
  },

  async unbanWallet(walletAddress: string) {
    try {
      await Promise.all([
        redis.srem('banned:wallets:permanent', walletAddress.toLowerCase()),
        redis.srem('banned:wallets:temporary', walletAddress.toLowerCase())
      ])
      console.log('✅ Unbanned wallet:', walletAddress)
      return true
    } catch (error) {
      console.error('❌ Error unbanning wallet:', error)
      return false
    }
  },

  async isBanned(walletAddress: string): Promise<boolean> {
    try {
      const [isPermanent, isTemporary] = await Promise.all([
        redis.sismember('banned:wallets:permanent', walletAddress.toLowerCase()),
        redis.sismember('banned:wallets:temporary', walletAddress.toLowerCase())
      ])
      return Boolean(isPermanent) || Boolean(isTemporary)
    } catch (error) {
      console.error('❌ Error checking ban status:', error)
      return false
    }
  }
}

// Add health check function
export async function checkRedisConnection() {
  try {
    await redis.ping()
    console.log('✅ Redis connection healthy')
    return true
  } catch (error) {
    console.error('❌ Redis connection error:', error)
    return false
  }
}

// Initial health check
checkRedisConnection()

// Add a utility function to get environment-specific Redis queue names
export const getQueueName = (baseQueueName: string): string => {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev:' : '';
  return `${prefix}${baseQueueName}`;
}; 