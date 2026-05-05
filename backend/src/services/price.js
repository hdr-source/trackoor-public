import { createClient } from 'redis';
import axios from 'axios';

let redis;
let redisReady = false;

// In-memory fallback so the bot doesn't fall over if Redis blips. Price is
// only cached for 60s anyway so a brief outage just costs us a few extra
// CoinGecko/Jupiter requests, not correctness.
let memPriceCache = { price: null, expires: 0 };
const memConversationState = new Map();

export async function getRedisClient() {
  if (redis && redisReady) return redis;

  if (!redis) {
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', () => { redisReady = false; });
    redis.on('ready', () => { redisReady = true; });
  }

  if (!redisReady) {
    try { await redis.connect(); } catch { /* retried on next call */ }
  }
  return redisReady ? redis : null;
}

async function cacheGet(key) {
  const client = await getRedisClient();
  if (client) {
    try { return await client.get(key); } catch { /* fall through */ }
  }
  if (key === 'sol:usd:price' && memPriceCache.expires > Date.now()) {
    return memPriceCache.price?.toString() ?? null;
  }
  return null;
}

async function cacheSet(key, value, ttlSeconds) {
  if (key === 'sol:usd:price') {
    memPriceCache = { price: parseFloat(value), expires: Date.now() + ttlSeconds * 1000 };
  }
  const client = await getRedisClient();
  if (client) {
    try { await client.setEx(key, ttlSeconds, value); } catch { /* non-critical */ }
  }
}

// Fetches SOL/USD with a 60s cache. CoinGecko is the primary source; Jupiter
// is the fallback because CoinGecko's free tier rate-limits aggressively under
// any real load.
export async function getSolPrice() {
  const cached = await cacheGet('sol:usd:price');
  if (cached) return parseFloat(cached);

  try {
    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { timeout: 3000 }
    );
    const price = res.data?.solana?.usd;
    if (price) {
      await cacheSet('sol:usd:price', price.toString(), 60);
      return price;
    }
  } catch (err) {
    console.error('CoinGecko price fetch failed, trying Jupiter:', err.message);
  }

  try {
    const res = await axios.get('https://price.jup.ag/v4/price?ids=SOL', { timeout: 3000 });
    const price = res.data?.data?.SOL?.price;
    if (price) {
      await cacheSet('sol:usd:price', price.toString(), 60);
      return price;
    }
  } catch (err) {
    console.error('Jupiter price fallback failed:', err.message);
  }

  return memPriceCache.price ?? 0;
}

export async function toUSD(solAmount) {
  return solAmount * (await getSolPrice());
}

// Telegram conversation state for multi-step flows (e.g. /add → "send address"
// → "send label"). Stored in Redis with a 5min TTL so an abandoned flow gets
// cleaned up automatically.
export async function setConversationState(chatId, state) {
  memConversationState.set(String(chatId), { state, expires: Date.now() + 300_000 });
  const client = await getRedisClient();
  if (client) {
    try { await client.setEx(`tg:state:${chatId}`, 300, JSON.stringify(state)); } catch { /* non-critical */ }
  }
}

export async function getConversationState(chatId) {
  const client = await getRedisClient();
  if (client) {
    try {
      const data = await client.get(`tg:state:${chatId}`);
      if (data) return JSON.parse(data);
    } catch { /* fall through to memory */ }
  }
  const mem = memConversationState.get(String(chatId));
  if (mem && mem.expires > Date.now()) return mem.state;
  return null;
}

export async function clearConversationState(chatId) {
  memConversationState.delete(String(chatId));
  const client = await getRedisClient();
  if (client) {
    try { await client.del(`tg:state:${chatId}`); } catch { /* non-critical */ }
  }
}
