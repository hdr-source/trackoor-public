import { query } from '../db/index.js';

// Updates the running position for a wallet+token whenever a swap comes in.
// Buys add to total_sol_spent / tokens_bought; sells add to total_sol_received
// / tokens_sold and accumulate realised PNL in USD.
export async function updatePosition(walletAddress, parsedTx, solPriceUsd) {
  const { token_address, direction, sol_amount, token_amount } = parsedTx;
  if (!token_address || !sol_amount) return null;

  const usdValue = sol_amount * solPriceUsd;

  if (direction === 'BUY') {
    await query(`
      INSERT INTO wallet_positions
        (wallet_address, token_address, total_sol_spent, total_tokens_bought,
         avg_buy_price, first_buy_at, last_activity_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (wallet_address, token_address) DO UPDATE SET
        total_sol_spent = wallet_positions.total_sol_spent + $3,
        total_tokens_bought = wallet_positions.total_tokens_bought + $4,
        avg_buy_price = (wallet_positions.total_sol_spent + $3) /
                        NULLIF(wallet_positions.total_tokens_bought + $4, 0),
        last_activity_at = NOW()
    `, [walletAddress, token_address, sol_amount, token_amount || 0,
        token_amount ? sol_amount / token_amount : null]);
  }

  if (direction === 'SELL') {
    const pos = await getPosition(walletAddress, token_address);
    let realizedPnl = 0;
    if (pos?.avg_buy_price && token_amount) {
      const costBasis = pos.avg_buy_price * token_amount * solPriceUsd;
      realizedPnl = usdValue - costBasis;
    }

    await query(`
      INSERT INTO wallet_positions
        (wallet_address, token_address, total_sol_received, total_tokens_sold,
         realized_pnl_usd, last_activity_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (wallet_address, token_address) DO UPDATE SET
        total_sol_received = wallet_positions.total_sol_received + $3,
        total_tokens_sold = wallet_positions.total_tokens_sold + $4,
        realized_pnl_usd = wallet_positions.realized_pnl_usd + $5,
        last_activity_at = NOW()
    `, [walletAddress, token_address, sol_amount, token_amount || 0, realizedPnl]);
  }

  return getPosition(walletAddress, token_address);
}

export async function getPosition(walletAddress, tokenAddress) {
  const result = await query(
    'SELECT * FROM wallet_positions WHERE wallet_address = $1 AND token_address = $2',
    [walletAddress, tokenAddress]
  );
  return result.rows[0] || null;
}

export async function getPnlSummary(walletAddress, tokenAddress, currentSolPrice) {
  const pos = await getPosition(walletAddress, tokenAddress);
  if (!pos) return null;

  const totalSolSpent = parseFloat(pos.total_sol_spent);
  const totalSolReceived = parseFloat(pos.total_sol_received);
  const totalSpentUsd = totalSolSpent * currentSolPrice;
  const totalReceivedUsd = totalSolReceived * currentSolPrice;

  return {
    avg_buy_price: pos.avg_buy_price,
    total_invested_usd: totalSpentUsd,
    realized_pnl_usd: parseFloat(pos.realized_pnl_usd),
    realized_pnl_sol: totalSolReceived - totalSolSpent,
    pnl_percent: totalSpentUsd > 0
      ? ((totalReceivedUsd - totalSpentUsd) / totalSpentUsd) * 100
      : 0,
    first_buy_at: pos.first_buy_at,
  };
}
