-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address VARCHAR(44) UNIQUE NOT NULL,
  label VARCHAR(100),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-wallet filter settings
CREATE TABLE IF NOT EXISTS wallet_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
  notify_buys BOOLEAN DEFAULT true,
  notify_sells BOOLEAN DEFAULT true,
  notify_token_creates BOOLEAN DEFAULT true,
  notify_transfers BOOLEAN DEFAULT false,
  threshold_value DECIMAL(18, 6),
  threshold_currency VARCHAR(3) DEFAULT 'USD',
  skip_threshold_for_creates BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_id)
);

-- Transaction log
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  wallet_address VARCHAR(44) NOT NULL,
  signature VARCHAR(88) UNIQUE NOT NULL,
  tx_type VARCHAR(30) NOT NULL,
  direction VARCHAR(4),
  token_address VARCHAR(44),
  token_symbol VARCHAR(20),
  token_amount DECIMAL(30, 9),
  sol_amount DECIMAL(18, 9),
  usd_value DECIMAL(18, 2),
  price_per_token DECIMAL(30, 12),
  market_cap DECIMAL(18, 2),
  dex VARCHAR(30),
  sol_price_at_tx DECIMAL(10, 2),
  notified BOOLEAN DEFAULT false,
  raw_payload JSONB,
  tx_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(tx_type);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(tx_timestamp DESC);

-- PNL tracking per wallet per token
CREATE TABLE IF NOT EXISTS wallet_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(44) NOT NULL,
  token_address VARCHAR(44) NOT NULL,
  total_sol_spent DECIMAL(18, 9) DEFAULT 0,
  total_sol_received DECIMAL(18, 9) DEFAULT 0,
  total_tokens_bought DECIMAL(30, 9) DEFAULT 0,
  total_tokens_sold DECIMAL(30, 9) DEFAULT 0,
  avg_buy_price DECIMAL(30, 12),
  realized_pnl_usd DECIMAL(18, 2) DEFAULT 0,
  first_buy_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address, token_address)
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallets_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER wallet_filters_updated_at BEFORE UPDATE ON wallet_filters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER wallet_positions_updated_at BEFORE UPDATE ON wallet_positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
