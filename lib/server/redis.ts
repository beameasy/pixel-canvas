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
console.log('🔵 Redis URL:', config.url)

export const redis = new Redis({
  url: config.url,
  token: config.token,
}) 