import { query } from '../db/index.js';
import { syncWebhookAddresses } from './helius.js';

const WALLET_WITH_FILTERS = `
  SELECT w.*, row_to_json(wf.*) as filters
  FROM wallets w
  LEFT JOIN wallet_filters wf ON wf.wallet_id = w.id
`;

export async function getAllWallets() {
  const result = await query(`${WALLET_WITH_FILTERS} ORDER BY w.created_at DESC`);
  return result.rows;
}

export async function getWalletByAddress(address) {
  const result = await query(`${WALLET_WITH_FILTERS} WHERE w.address = $1`, [address]);
  return result.rows[0] || null;
}

export async function getActiveWalletAddresses() {
  const result = await query('SELECT address FROM wallets WHERE active = true');
  return result.rows.map(r => r.address);
}

export async function addWallet(address, label = null) {
  const existing = await getWalletByAddress(address);
  if (existing) {
    await query('UPDATE wallets SET active = true, label = $2 WHERE address = $1', [address, label]);
    await resyncHelius();
    return getWalletByAddress(address);
  }

  const result = await query(
    'INSERT INTO wallets (address, label) VALUES ($1, $2) RETURNING *',
    [address, label]
  );
  await query('INSERT INTO wallet_filters (wallet_id) VALUES ($1)', [result.rows[0].id]);
  await resyncHelius();
  return getWalletByAddress(address);
}

export async function deleteWallet(address) {
  await query('DELETE FROM wallets WHERE address = $1', [address]);
  await resyncHelius();
}

export async function updateWalletLabel(address, label) {
  await query('UPDATE wallets SET label = $2 WHERE address = $1', [address, label]);
}

const FILTER_FIELDS = [
  'notify_buys', 'notify_sells', 'notify_token_creates',
  'notify_transfers', 'threshold_value', 'threshold_currency',
  'skip_threshold_for_creates',
];

export async function updateWalletFilters(address, filters) {
  const wallet = await getWalletByAddress(address);
  if (!wallet) throw new Error('Wallet not found');

  const updates = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(filters)) {
    if (FILTER_FIELDS.includes(key)) {
      updates.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }
  if (updates.length === 0) return;

  values.push(wallet.id);
  await query(
    `UPDATE wallet_filters SET ${updates.join(', ')} WHERE wallet_id = $${idx}`,
    values
  );
}

export async function toggleWallet(address) {
  const result = await query(
    'UPDATE wallets SET active = NOT active WHERE address = $1 RETURNING active',
    [address]
  );
  await resyncHelius();
  return result.rows[0]?.active;
}

// Sync failure shouldn't break the request — log and move on. The webhook will
// be a tx behind until the next add/remove triggers another sync.
export async function resyncHelius() {
  try {
    const addresses = await getActiveWalletAddresses();
    await syncWebhookAddresses(addresses);
    console.log(`Synced ${addresses.length} wallets to Helius`);
  } catch (err) {
    console.error('Helius sync failed:', err.message);
  }
}

const DUST_THRESHOLD_SOL = 0.01;

export async function shouldNotify(walletAddress, parsedTx) {
  const wallet = await getWalletByAddress(walletAddress);
  if (!wallet || !wallet.active) return false;

  const filters = wallet.filters;
  if (!filters) return true;

  const { tx_type, direction, sol_amount } = parsedTx;

  // Drop dust/spam — anything under 0.01 SOL is almost certainly noise.
  if ((tx_type === 'SWAP' || tx_type === 'TRANSFER') &&
      (sol_amount == null || sol_amount < DUST_THRESHOLD_SOL)) {
    return false;
  }

  if (tx_type === 'TOKEN_CREATE' && !filters.notify_token_creates) return false;
  if (tx_type === 'TRANSFER' && !filters.notify_transfers) return false;
  if (tx_type === 'SWAP') {
    if (direction === 'BUY' && !filters.notify_buys) return false;
    if (direction === 'SELL' && !filters.notify_sells) return false;
  }

  // Token creates can bypass the threshold — useful for catching new launches
  // before the dev does any meaningful buy/sell volume.
  if (tx_type === 'TOKEN_CREATE' && filters.skip_threshold_for_creates) return true;

  if (filters.threshold_value && sol_amount) {
    const { getSolPrice } = await import('./price.js');
    const threshold = parseFloat(filters.threshold_value);
    const compareValue = filters.threshold_currency === 'USD'
      ? sol_amount * (await getSolPrice())
      : sol_amount;
    if (compareValue < threshold) return false;
  }

  return true;
}
