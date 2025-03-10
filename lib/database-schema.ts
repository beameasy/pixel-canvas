/**
 * Database Schema Definitions
 * 
 * This file defines the fields available in each table to ensure consistency
 * across the application and prevent database errors from field mismatches.
 */

// Define the fields available in the users/dev_users table
export const USER_TABLE_FIELDS = [
  'wallet_address',   // Primary key (text)
  'farcaster_username', // text
  'farcaster_pfp',    // text
  'last_active',      // timestamp
  'updated_at',       // timestamp
  'token_balance',    // numeric
  'privy_id'          // text
];

// Define the fields available in the pixels/dev_pixels table
export const PIXEL_TABLE_FIELDS = [
  'id',               // uuid
  'x',                // int4
  'y',                // int4
  'color',            // varchar
  'wallet_address',   // text
  'placed_at',        // timestamp
  'farcaster_username', // text
  'farcaster_pfp',    // text
  'token_balance',    // numeric
  'is_void',          // bool
  'version'           // int4
];

// Define the fields available in the banned_wallets/dev_banned_wallets table
export const BANNED_WALLETS_TABLE_FIELDS = [
  'id',               // uuid
  'wallet_address',   // text
  'banned_at',        // timestamp
  'banned_by',        // text
  'reason',           // text
  'active'            // bool
];

/**
 * Filter an object to only include fields that exist in the specified table
 * @param data The data object to filter
 * @param tableFields Array of allowed field names
 * @returns A new object with only the allowed fields
 */
export function filterForTableSchema(data: Record<string, any>, tableFields: string[]): Record<string, any> {
  const filtered: Record<string, any> = {};
  
  tableFields.forEach(field => {
    if (field in data) {
      filtered[field] = data[field];
    }
  });
  
  return filtered;
} 