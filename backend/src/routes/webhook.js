import express from 'express';
import { query } from '../db/index.js';
import { parseHeliusTransaction } from '../services/helius.js';
import { shouldNotify, getWalletByAddress } from '../services/wallet.js';
import { getSolPrice } from '../services/price.js';
import { updatePosition, getPnlSummary } from '../services/pnl.js';
import {
  formatSwapMessage,
  formatTokenCreateMessage,
  formatTransferMessage,
  getNotificationKeyboard,
} from '../services/formatter.js';
import { sendNotification } from '../bot/index.js';

const router = express.Router();
const SOL_MINT = 'So11111111111111111111111111111111111111112';

router.post('/helius', async (req, res) => {
  if (req.headers['authorization'] !== process.env.HELIUS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Helius retries if we don't ack within a few seconds, so respond first and
  // process asynchronously. Sort by timestamp so a wallet's buys are recorded
  // before the matching sells — otherwise PNL on the sell goes negative.
  res.status(200).json({ ok: true });

  const transactions = Array.isArray(req.body) ? req.body : [req.body];
  transactions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  for (const rawTx of transactions) {
    try {
      await processTransaction(rawTx);
    } catch (err) {
      console.error('Error processing tx', rawTx?.signature, err.message);
    }
  }
});

async function processTransaction(rawTx) {
  const parsed = await parseHeliusTransaction(rawTx);
  if (!parsed.signature) return;

  // Helius occasionally double-sends the same tx — UNIQUE constraint on
  // signature catches it but we skip the work entirely if we've seen it.
  const existing = await query('SELECT id FROM transactions WHERE signature = $1', [parsed.signature]);
  if (existing.rows.length > 0) return;

  // Find which of OUR tracked wallets this tx involves. Helius sends the same
  // payload no matter which subscribed address triggered it.
  const accountAddresses = rawTx.accountData?.map(a => a.account) || [];
  let trackedWallet = null;
  for (const address of accountAddresses) {
    const w = await getWalletByAddress(address);
    if (w) { trackedWallet = w; break; }
  }
  if (!trackedWallet) return;

  // For TRANSFERs the parser couldn't fill in sol_amount/direction — it didn't
  // know which wallet was "ours". Now we do, so derive both from the tracked
  // wallet's balance change.
  if (parsed.tx_type === 'TRANSFER') {
    const trackedAccount = rawTx.accountData?.find(a => a.account === trackedWallet.address);
    if (trackedAccount) {
      const balanceChange = trackedAccount.nativeBalanceChange || 0;
      parsed.sol_amount = Math.abs(balanceChange) / 1e9;
      parsed.direction = balanceChange < 0 ? 'OUT' : 'IN';
    }

    const tokenXfer = (rawTx.tokenTransfers || []).find(t =>
      t.mint !== SOL_MINT &&
      (t.fromUserAccount === trackedWallet.address || t.toUserAccount === trackedWallet.address)
    );
    if (tokenXfer) {
      parsed.token_address = tokenXfer.mint;
      parsed.token_amount = tokenXfer.tokenAmount;
      if (tokenXfer.tokenSymbol) parsed.token_symbol = tokenXfer.tokenSymbol;
      parsed.direction = tokenXfer.fromUserAccount === trackedWallet.address ? 'OUT' : 'IN';
    }
  }

  const solPrice = await getSolPrice();
  parsed.usd_value = parsed.sol_amount ? parsed.sol_amount * solPrice : null;

  await query(`
    INSERT INTO transactions (
      wallet_id, wallet_address, signature, tx_type, direction,
      token_address, token_symbol, token_amount, sol_amount, usd_value,
      price_per_token, market_cap, dex, sol_price_at_tx, tx_timestamp, raw_payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (signature) DO NOTHING
  `, [
    trackedWallet.id, trackedWallet.address, parsed.signature,
    parsed.tx_type, parsed.direction, parsed.token_address, parsed.token_symbol,
    parsed.token_amount, parsed.sol_amount, parsed.usd_value, parsed.price_per_token,
    parsed.market_cap, parsed.dex, solPrice, parsed.tx_timestamp,
    JSON.stringify(parsed.raw_payload),
  ]);

  let pnl = null;
  if (parsed.tx_type === 'SWAP' && parsed.token_address) {
    await updatePosition(trackedWallet.address, parsed, solPrice);
    if (parsed.direction === 'SELL') {
      pnl = await getPnlSummary(trackedWallet.address, parsed.token_address, solPrice);
    }
  }

  if (!(await shouldNotify(trackedWallet.address, parsed))) return;

  let message;
  if (parsed.tx_type === 'SWAP') message = formatSwapMessage(trackedWallet, parsed, pnl, solPrice);
  else if (parsed.tx_type === 'TOKEN_CREATE') message = formatTokenCreateMessage(trackedWallet, parsed);
  else if (parsed.tx_type === 'TRANSFER') message = formatTransferMessage(trackedWallet, parsed, solPrice);

  if (message) {
    const keyboard = getNotificationKeyboard(trackedWallet.address, parsed.token_address, parsed.signature);
    await sendNotification(message, keyboard);
    await query('UPDATE transactions SET notified = true WHERE signature = $1', [parsed.signature]);
  }
}

export default router;
