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