import axios from 'axios';

const HELIUS_BASE = 'https://api.helius.xyz/v0';
const API_KEY = process.env.HELIUS_API_KEY;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export async function getWebhook() {
  const res = await axios.get(
    `${HELIUS_BASE}/webhooks/${process.env.HELIUS_WEBHOOK_ID}?api-key=${API_KEY}`
  );
  return res.data;
}

// Replaces the full address list on the Helius webhook. Called whenever
// wallets are added/removed so Helius only sends us the txs we care about.
export async function syncWebhookAddresses(addresses) {
  if (!process.env.HELIUS_WEBHOOK_ID) {
    console.warn('No HELIUS_WEBHOOK_ID set, skipping sync');
    return;
  }

  // Helius rejects empty arrays — stub with the system program address so the
  // webhook stays alive when no wallets are tracked.
  const addrs = addresses.length > 0 ? addresses : ['11111111111111111111111111111111'];

  const res = await axios.put(
    `${HELIUS_BASE}/webhooks/${process.env.HELIUS_WEBHOOK_ID}?api-key=${API_KEY}`,
    {
      webhookURL: process.env.HELIUS_WEBHOOK_URL,
      transactionTypes: ['SWAP', 'TOKEN_MINT', 'TRANSFER'],
      accountAddresses: addrs,
      webhookType: 'enhanced',
      authHeader: process.env.HELIUS_WEBHOOK_SECRET,
    }
  );
  return res.data;
}

// One-off: run this once during setup to create the webhook record.
export async function createWebhook(addresses = []) {
  const res = await axios.post(
    `${HELIUS_BASE}/webhooks?api-key=${API_KEY}`,
    {
      webhookURL: process.env.HELIUS_WEBHOOK_URL,
      transactionTypes: ['SWAP', 'TOKEN_MINT', 'TRANSFER'],
      accountAddresses: addresses,
      webhookType: 'enhanced',
      authHeader: process.env.HELIUS_WEBHOOK_SECRET,
    }
  );
  console.log('Created webhook:', res.data.webhookID);
  return res.data;
}

async function fetchTokenSymbol(mintAddress) {
  try {
    const res = await axios.post(`https://mainnet.helius-rpc.com/?api-key=${API_KEY}`, {
      jsonrpc: '2.0',
      id: 'token-meta',
      method: 'getAsset',
      params: { id: mintAddress },
    });
    const content = res.data?.result?.content;
    return content?.metadata?.symbol || res.data?.result?.token_info?.symbol || null;
  } catch {
    return null;
  }
}

// Turns a raw Helius enhanced-webhook payload into the shape our DB expects.
export async function parseHeliusTransaction(tx) {
  const parsed = {
    signature: tx.signature,
    tx_type: normaliseType(tx.type),
    direction: null,
    token_address: null,
    token_symbol: null,
    token_amount: null,
    sol_amount: null,
    usd_value: null,
    price_per_token: null,
    market_cap: null,
    dex: tx.source,
    tx_timestamp: new Date(tx.timestamp * 1000),
    raw_payload: tx,
  };

  if (tx.type === 'SWAP' && tx.tokenTransfers?.length > 0) {
    const wallet = tx.feePayer;
    const tokenTransfer = tx.tokenTransfers.find(t => t.mint !== SOL_MINT) || tx.tokenTransfers[0];

    parsed.direction = tokenTransfer.toUserAccount === wallet ? 'BUY' : 'SELL';

    // SOL spent/received comes from the wallet's native balance change in
    // accountData — more reliable than summing up nativeTransfers.
    const walletAccount = (tx.accountData || []).find(a => a.account === wallet);
    parsed.sol_amount = Math.abs(walletAccount?.nativeBalanceChange || 0) / 1e9;

    parsed.token_address = tokenTransfer.mint;
    parsed.token_amount = tokenTransfer.tokenAmount;
    parsed.token_symbol = tokenTransfer.tokenSymbol
      || (tokenTransfer.mint && await fetchTokenSymbol(tokenTransfer.mint))
      || 'UNKNOWN';

    if (parsed.sol_amount > 0 && tokenTransfer.tokenAmount > 0) {
      parsed.price_per_token = parsed.sol_amount / tokenTransfer.tokenAmount;
    }
  }

  if (tx.type === 'TOKEN_MINT' || tx.type === 'CREATE_TOKEN') {
    parsed.tx_type = 'TOKEN_CREATE';
    parsed.token_address = tx.tokenTransfers?.[0]?.mint;
    parsed.token_symbol = tx.tokenTransfers?.[0]?.tokenSymbol
      || (parsed.token_address && await fetchTokenSymbol(parsed.token_address))
      || null;
  }

  // For TRANSFER, sol_amount and direction depend on which of OUR wallets is
  // involved — we can't know that here, so the webhook handler fills them in.
  if (tx.type === 'TRANSFER') {
    const tokenXfers = (tx.tokenTransfers || []).filter(t => t.mint !== SOL_MINT);
    if (tokenXfers.length > 0) {
      const biggest = tokenXfers.reduce((a, b) =>
        Math.abs(b.tokenAmount) > Math.abs(a.tokenAmount) ? b : a
      );
      parsed.token_address = biggest.mint;
      parsed.token_symbol = biggest.tokenSymbol
        || (biggest.mint && await fetchTokenSymbol(biggest.mint))
        || null;
    }
  }

  return parsed;
}

function normaliseType(heliusType) {
  const map = {
    SWAP: 'SWAP',
    TOKEN_MINT: 'TOKEN_CREATE',
    CREATE_TOKEN: 'TOKEN_CREATE',
    TRANSFER: 'TRANSFER',
  };
  return map[heliusType] || heliusType;
}
