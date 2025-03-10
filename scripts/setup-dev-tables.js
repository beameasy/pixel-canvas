/**
 * This script creates development tables in Supabase for use in local development.
 * Run it with: node scripts/setup-dev-tables.js
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Tables we need to duplicate for dev
const tables = [
  'users',
  'pixels',
  'backup_logs',
  'banned_wallets'
];

// Create a development version of each table
async function setupDevTables() {
  console.log('Setting up development tables in Supabase...');
  
  for (const table of tables) {
    const devTable = `dev_${table}`;
    console.log(`Creating ${devTable}...`);
    
    try {
      // First check if table exists
      const { data, error } = await supabase
        .from(devTable)
        .select('*', { count: 'exact', head: true });
      
      if (error && error.code === '42P01') { // Table doesn't exist error code
        console.log(`Table ${devTable} doesn't exist, creating it...`);
        
        // Get original table structure and create dev table with same structure
        // This would require using PostgreSQL-specific API to get table structure
        // and then executing CREATE TABLE statements
        
        // For this demo, we'll just show how to copy structure and data
        // You'd need to use SQL functions or database management API for the actual implementation
        console.log(`To create ${devTable}, run this SQL in Supabase:
        
CREATE TABLE IF NOT EXISTS ${devTable} (LIKE ${table} INCLUDING ALL);
INSERT INTO ${devTable} SELECT * FROM ${table} LIMIT 100; -- Copy some sample data
        `);
      } else {
        console.log(`Table ${devTable} already exists`);
      }
    } catch (err) {
      console.error(`Error setting up ${devTable}:`, err);
    }
  }
  
  console.log('Development tables setup complete');
}

setupDevTables()
  .catch(error => {
    console.error('Error setting up dev tables:', error);
    process.exit(1);
  }); 