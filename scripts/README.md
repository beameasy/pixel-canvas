# Redis Utility Scripts

This directory contains utility scripts for managing Redis data between environments.

## Scripts Overview

### 1. `migrate-cache-data.js`

This script fully replicates all data from the production Redis database to the development Redis database.

**Features:**
- Copies ALL keys, regardless of type (string, hash, set, zset, list)
- Preserves TTLs (time-to-live) for all keys
- Batches operations to handle large datasets
- Provides detailed progress reporting
- Handles errors gracefully

**Usage:**
```bash
# Ensure .env.local has your Redis credentials
node scripts/migrate-cache-data.js
```

### 2. `cleanup-test-keys.js`

This script removes test keys from the production Redis database. It specifically targets keys with the prefix `test:`.

**Features:**
- Safely identifies all test keys in production
- Requires explicit confirmation before deletion
- Reports on deleted keys
- Handles errors gracefully

**Usage:**
```bash
# Ensure .env.local has your Redis credentials
node scripts/cleanup-test-keys.js
```

## Environment Setup

Both scripts require the following environment variables in your `.env.local` file:

```
# Production Redis credentials
UPSTASH_REDIS_REST_URL=your_prod_url
UPSTASH_REDIS_REST_TOKEN=your_prod_token

# Development Redis credentials
UPSTASH_REDIS_REST_DEV_URL=your_dev_url
UPSTASH_REDIS_REST_DEV_TOKEN=your_dev_token
```

## Important Notes

1. **Always run these scripts with caution**, especially when targeting production data.
2. The migration script will **completely overwrite** your development Redis. Make sure you're okay with this before proceeding.
3. It's recommended to run these scripts during low-traffic periods.
4. Keep an eye on Redis memory usage during large migrations.

## Dependencies

These scripts depend on:
- `@upstash/redis`: For Redis operations
- `dotenv`: For loading environment variables 