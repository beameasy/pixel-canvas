-- Test RLS policies

-- Enable RLS for this session
ALTER TABLE pixels FORCE ROW LEVEL SECURITY;

-- Create test user
INSERT INTO users (wallet_address, privy_id) 
VALUES ('0x1111111111111111111111111111111111111111', 'test-privy-id');

-- Set role and claims
SET SESSION ROLE authenticated;
SET request.jwt.claims = '{"wallet_address": "0x4325775d28154fe505169cd1b680af5c0c589ca8"}';

-- Debug current state
SELECT current_user, session_user;
SELECT auth.jwt()->>'wallet_address' as jwt_wallet;

-- Test 1: Rate limiting - try to insert 5 pixels rapidly
DO $$ 
DECLARE
  recent_count integer;
BEGIN
  -- First insert
  INSERT INTO pixels (x, y, color, wallet_address) 
  VALUES (1, 1, '#000000', '0x4325775d28154fe505169cd1b680af5c0c589ca8');
  
  SELECT COUNT(*) INTO recent_count FROM pixels 
  WHERE wallet_address = '0x4325775d28154fe505169cd1b680af5c0c589ca8'
  AND placed_at > now() - interval '2 seconds';
  RAISE NOTICE 'After first insert: % pixels in last 2s', recent_count;
  
  -- Second insert
  INSERT INTO pixels (x, y, color, wallet_address) 
  VALUES (2, 2, '#000000', '0x4325775d28154fe505169cd1b680af5c0c589ca8');
  
  SELECT COUNT(*) INTO recent_count FROM pixels 
  WHERE wallet_address = '0x4325775d28154fe505169cd1b680af5c0c589ca8'
  AND placed_at > now() - interval '2 seconds';
  RAISE NOTICE 'After second insert: % pixels in last 2s', recent_count;
  
  -- Third insert
  INSERT INTO pixels (x, y, color, wallet_address) 
  VALUES (3, 3, '#000000', '0x4325775d28154fe505169cd1b680af5c0c589ca8');
  
  SELECT COUNT(*) INTO recent_count FROM pixels 
  WHERE wallet_address = '0x4325775d28154fe505169cd1b680af5c0c589ca8'
  AND placed_at > now() - interval '2 seconds';
  RAISE NOTICE 'After third insert: % pixels in last 2s', recent_count;
  
  -- Fourth insert (should be the last successful one)
  INSERT INTO pixels (x, y, color, wallet_address) 
  VALUES (4, 4, '#000000', '0x4325775d28154fe505169cd1b680af5c0c589ca8');
  
  SELECT COUNT(*) INTO recent_count FROM pixels 
  WHERE wallet_address = '0x4325775d28154fe505169cd1b680af5c0c589ca8'
  AND placed_at > now() - interval '2 seconds';
  RAISE NOTICE 'After fourth insert: % pixels in last 2s', recent_count;
  
  -- This one should fail
  INSERT INTO pixels (x, y, color, wallet_address) 
  VALUES (5, 5, '#000000', '0x4325775d28154fe505169cd1b680af5c0c589ca8');
  
  RAISE NOTICE 'Should not reach here - rate limit failed';
  
EXCEPTION 
  WHEN others THEN 
    RAISE NOTICE 'Expected rate limit error: %', SQLERRM;
END $$;

-- Check results within last 2 seconds
SELECT COUNT(*) as recent_pixels
FROM pixels 
WHERE wallet_address = '0x4325775d28154fe505169cd1b680af5c0c589ca8'
AND placed_at > now() - interval '2 seconds';

-- Check all results
SELECT * FROM pixels ORDER BY placed_at DESC;

-- Test 2: Should fail - different wallet than JWT claim
DO $$ 
BEGIN
  INSERT INTO pixels (x, y, color, wallet_address) 
  VALUES (2, 2, '#000000', '0x1111111111111111111111111111111111111111');
EXCEPTION 
  WHEN others THEN 
    RAISE NOTICE 'Expected RLS error: %', SQLERRM;
END $$;

-- Test 3: Switch to service role (should bypass RLS)
SET SESSION ROLE service_role;
INSERT INTO pixels (x, y, color, wallet_address) 
VALUES (7, 7, '#000000', '0x1111111111111111111111111111111111111111')
RETURNING 'Service role insert succeeded' as result;

-- Check final results
SELECT * FROM pixels WHERE x BETWEEN 1 AND 7 ORDER BY x; 