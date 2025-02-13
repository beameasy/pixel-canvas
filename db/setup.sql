DROP FUNCTION IF EXISTS check_rate_limit();
DROP TRIGGER IF EXISTS check_rate_limit ON pixels;

-- Create rate limiting and token balance check function
CREATE FUNCTION check_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count integer;
  existing_pixel record;
  writer_balance numeric;
  current_owner_balance numeric;
BEGIN
  -- First check rate limit
  SELECT COUNT(*)
  INTO recent_count
  FROM pixels
  WHERE wallet_address = NEW.wallet_address
  AND placed_at > now() - interval '300 seconds';

  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded: % pixels in last 5 minutes', recent_count;
  END IF;

  -- Check if pixel exists at this position
  SELECT p.*, u.token_balance as owner_balance
  INTO existing_pixel
  FROM pixels p
  JOIN users u ON p.wallet_address = u.wallet_address
  WHERE p.x = NEW.x AND p.y = NEW.y
  ORDER BY p.placed_at DESC
  LIMIT 1;

  -- Get writer's token balance
  SELECT token_balance INTO writer_balance
  FROM users
  WHERE wallet_address = NEW.wallet_address;

  -- If pixel exists, check token balances
  IF existing_pixel IS NOT NULL THEN
    -- Can only overwrite if writer has more tokens
    IF writer_balance <= existing_pixel.owner_balance THEN
      RAISE EXCEPTION 'Cannot overwrite pixel - current owner has % tokens, you have % tokens', 
        existing_pixel.owner_balance, writer_balance;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER check_rate_limit
  BEFORE INSERT ON pixels
  FOR EACH ROW
  EXECUTE FUNCTION check_rate_limit();

-- Add token_balance column if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'users' 
    AND column_name = 'token_balance'
  ) THEN
    ALTER TABLE users ADD COLUMN token_balance numeric DEFAULT 0;
  END IF;
END $$;

-- Function to update token balance with validation
CREATE OR REPLACE FUNCTION update_token_balance(
  wallet text,
  new_balance numeric
) RETURNS void AS $$
BEGIN
  -- Validate wallet exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE wallet_address = wallet) THEN
    RAISE EXCEPTION 'Wallet % not found', wallet;
  END IF;

  -- Validate balance is not negative
  IF new_balance < 0 THEN
    RAISE EXCEPTION 'Token balance cannot be negative';
  END IF;

  -- Update balance and timestamp
  UPDATE users 
  SET 
    token_balance = new_balance,
    updated_at = now()
  WHERE wallet_address = wallet;
END;
$$ LANGUAGE plpgsql;

-- Function to increment/decrement balance
CREATE OR REPLACE FUNCTION adjust_token_balance(
  wallet text,
  amount numeric
) RETURNS numeric AS $$
DECLARE
  new_balance numeric;
BEGIN
  -- Get current balance
  SELECT token_balance INTO new_balance
  FROM users 
  WHERE wallet_address = wallet;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet % not found', wallet;
  END IF;

  -- Calculate new balance
  new_balance := new_balance + amount;

  -- Validate not negative
  IF new_balance < 0 THEN
    RAISE EXCEPTION 'Token balance cannot go below 0';
  END IF;

  -- Update balance
  UPDATE users 
  SET 
    token_balance = new_balance,
    updated_at = now()
  WHERE wallet_address = wallet;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;