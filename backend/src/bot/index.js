import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

import {
  getAllWallets,
  addWallet,
  deleteWallet,
  updateWalletFilters,
  updateWalletLabel,
  toggleWallet,
  getWalletByAddress,
} from '../services/wallet.js';
import {
  setConversationState,
  getConversationState,
  clearConversationState,
} from '../services/price.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ALLOWED_CHAT = process.env.TELEGRAM_CHAT_ID;

// Single-user bot — only the chat ID in env can talk to it. The dashboard is
// the multi-user-ish surface; the bot is just a personal alert channel.
bot.use(async (ctx, next) => {
  if (ctx.chat?.id?.toString() !== ALLOWED_CHAT) return ctx.reply('Unauthorized.');
  return next();
});

bot.command('start', (ctx) => ctx.replyWithHTML(
  `🔭 <b>Solana Wallet Tracker</b>\n\nCommands:\n` +
  `/wallets — List all tracked wallets\n` +
  `/add — Add a new wallet\n` +
  `/help — Show this menu`
));

bot.command('help', (ctx) => ctx.replyWithHTML(
  `🔭 <b>Commands</b>\n\n` +
  `/wallets — List & manage wallets\n` +
  `/add — Add a new wallet\n` +
  `/pause_all — Pause all notifications\n` +
  `/resume_all — Resume all notifications`
));

bot.command('wallets', async (ctx) => {
  const wallets = await getAllWallets();
  if (wallets.length === 0) return ctx.reply('No wallets tracked yet. Use /add to add one.');
  for (const w of wallets) await sendWalletRow(ctx, w);
});

bot.command('add', async (ctx) => {
  await setConversationState(ctx.chat.id, { step: 'awaiting_wallet_address' });
  await ctx.reply('Send me the Solana wallet address to track:');
});

bot.command('pause_all', async (ctx) => {
  for (const w of await getAllWallets()) if (w.active) await toggleWallet(w.address);
  await ctx.reply('⏸ All notifications paused.');
});

bot.command('resume_all', async (ctx) => {
  for (const w of await getAllWallets()) if (!w.active) await toggleWallet(w.address);
  await ctx.reply('▶️ All notifications resumed.');
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery();

  if (data.startsWith('e:')) {
    const wallet = await walletFromShort(data.slice(2));
    if (!wallet) return ctx.reply('Wallet not found.');
    return showFilterMenu(ctx, wallet);
  }

  if (data.startsWith('t:')) {
    const address = await resolveAddress(data.slice(2));
    if (!address) return;
    const isActive = await toggleWallet(address);
    return ctx.reply(isActive ? '▶️ Wallet resumed.' : '⏸ Wallet paused.');
  }

  if (data.startsWith('d:')) {
    const address = await resolveAddress(data.slice(2));
    if (!address) return;
    await setConversationState(chatId, { step: 'confirm_delete', address });
    return ctx.reply(
      `Are you sure you want to delete this wallet?\n<code>${address}</code>`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[
        Markup.button.callback('✅ Yes, delete', `cd:${shortAddr(address)}`),
        Markup.button.callback('❌ Cancel', 'cancel'),
      ]]) }
    );
  }

  if (data.startsWith('cd:')) {
    const address = await resolveAddress(data.slice(3));
    if (!address) return;
    await deleteWallet(address);
    await clearConversationState(chatId);
    return ctx.reply('🗑 Wallet deleted.');
  }

  if (data.startsWith('l:')) {
    const address = await resolveAddress(data.slice(2));
    if (!address) return;
    await setConversationState(chatId, { step: 'awaiting_label', address });
    return ctx.reply('Enter a new label for this wallet (e.g. "Smart Money #1"):');
  }

  // Toggle a single filter field (e.g. notify_buys) — repaints the keyboard
  // in-place so the menu doesn't spam new messages on every click.
  if (data.startsWith('tf:')) {
    const [, short, field] = data.split(':');
    const wallet = await walletFromShort(short);
    if (!wallet) return;
    const currentVal = wallet.filters?.[field] ?? true;
    await updateWalletFilters(wallet.address, { [field]: !currentVal });
    const updated = await getWalletByAddress(wallet.address);
    return ctx.editMessageReplyMarkup(buildFilterKeyboard(wallet.address, updated.filters).reply_markup);
  }

  if (data.startsWith('st:')) {
    const address = await resolveAddress(data.slice(3));
    if (!address) return;
    await setConversationState(chatId, { step: 'awaiting_threshold', address });
    return ctx.reply(
      'Enter minimum trade amount.\n\nExamples:\n• <code>500</code> → $500 USD\n• <code>10 SOL</code> → 10 SOL\n• <code>0</code> → remove threshold',
      { parse_mode: 'HTML' }
    );
  }

  if (data.startsWith('ct:')) {
    const address = await resolveAddress(data.slice(3));
    if (!address) return;
    await updateWalletFilters(address, { threshold_value: null });
    const wallet = await getWalletByAddress(address);
    await ctx.editMessageReplyMarkup(buildFilterKeyboard(address, wallet.filters).reply_markup);
    return ctx.reply('✅ Threshold removed.');
  }

  if (data === 'cancel') {
    await clearConversationState(chatId);
    return ctx.reply('Cancelled.');
  }

  // The pause button on a notification message — quick mute without opening menus.
  if (data.startsWith('p:')) {
    const address = await resolveAddress(data.slice(2));
    if (!address) return;
    await toggleWallet(address);
    return ctx.reply('⏸ Wallet paused.');
  }

  if (data === 'back_to_wallets') {
    const wallets = await getAllWallets();
    if (wallets.length === 0) return ctx.reply('No wallets tracked.');
    for (const w of wallets) await sendWalletRow(ctx, w);
  }
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.trim();
  const state = await getConversationState(chatId);

  if (!state) {
    if (!text.startsWith('/')) await ctx.reply('Use /wallets to manage wallets or /add to add a new one.');
    return;
  }

  switch (state.step) {
    case 'awaiting_wallet_address': {
      if (!isValidSolanaAddress(text)) {
        return ctx.reply("That doesn't look like a valid Solana address. Try again or /cancel:");
      }
      await setConversationState(chatId, { step: 'awaiting_label_for_new', address: text });
      return ctx.reply(
        `Got it! Enter a label for this wallet (or send "skip" to use the address):`,
        Markup.inlineKeyboard([[Markup.button.callback('Skip', 'skip_label')]])
      );
    }

    case 'awaiting_label_for_new': {
      const label = text === 'skip' ? null : text.slice(0, 100);
      const wallet = await addWallet(state.address, label);
      await clearConversationState(chatId);
      await ctx.replyWithHTML(
        `✅ Wallet added!\n<code>${wallet.address}</code>\nLabel: ${wallet.label || 'None'}\n\nConfigure filters:`
      );
      return showFilterMenu(ctx, wallet);
    }

    case 'awaiting_label': {
      await updateWalletLabel(state.address, text.slice(0, 100));
      await clearConversationState(chatId);
      return ctx.reply(`✅ Label updated to: ${text}`);
    }

    case 'awaiting_threshold': {
      const parsed = parseThresholdInput(text);
      if (parsed === null) return ctx.reply('Invalid format. Try "500" for $500 USD or "10 SOL":');

      if (parsed.value === 0) {
        await updateWalletFilters(state.address, { threshold_value: null });
        await clearConversationState(chatId);
        return ctx.reply('✅ Threshold removed.');
      }

      await updateWalletFilters(state.address, {
        threshold_value: parsed.value,
        threshold_currency: parsed.currency,
      });
      await clearConversationState(chatId);
      const wallet = await getWalletByAddress(state.address);
      await ctx.reply(`✅ Threshold set: ${parsed.value} ${parsed.currency}`);
      return showFilterMenu(ctx, wallet);
    }

    default:
      await clearConversationState(chatId);
  }
});

// Telegram callback_data has a 64-byte limit, which a 44-char base58 wallet
// address blows past once you add a prefix. We send only the first 8 chars
// in callbacks and look up the full address on the receiving end.
function shortAddr(address) { return address.slice(0, 8); }

async function resolveAddress(short) {
  const wallets = await getAllWallets();
  return wallets.find(w => w.address.startsWith(short))?.address || null;
}

async function walletFromShort(short) {
  const address = await resolveAddress(short);
  return address ? getWalletByAddress(address) : null;
}

async function sendWalletRow(ctx, w) {
  const label = w.label || `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
  const status = w.active ? '🟢' : '⏸';
  const f = w.filters || {};
  const types = [
    f.notify_buys && 'Buys',
    f.notify_sells && 'Sells',
    f.notify_token_creates && 'Creates',
    f.notify_transfers && 'Transfers',
  ].filter(Boolean);
  const threshold = f.threshold_value
    ? `Min: ${f.threshold_value} ${f.threshold_currency}`
    : 'No min';
  const text = `${status} <b>${label}</b>\n<code>${w.address}</code>\n📋 ${types.join(', ') || 'None'} | ${threshold}`;
  const s = shortAddr(w.address);
  await ctx.replyWithHTML(text, Markup.inlineKeyboard([
    [
      Markup.button.callback('⚙️ Filters', `e:${s}`),
      Markup.button.callback('✏️ Label', `l:${s}`),
      Markup.button.callback(w.active ? '⏸ Pause' : '▶️ Resume', `t:${s}`),
    ],
    [Markup.button.callback('🗑 Delete', `d:${s}`)],
  ]));
}

async function showFilterMenu(ctx, wallet) {
  const f = wallet.filters || {};
  const label = wallet.label || `${wallet.address.slice(0, 6)}...`;
  const threshold = f.threshold_value ? `${f.threshold_value} ${f.threshold_currency}` : 'None';
  await ctx.replyWithHTML(
    `⚙️ <b>Filters for ${label}</b>\n\nThreshold: <b>${threshold}</b>`,
    buildFilterKeyboard(wallet.address, f)
  );
}

function buildFilterKeyboard(address, f = {}) {
  const on = '✅', off = '❌';
  const s = shortAddr(address);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${f.notify_buys ? on : off} Buys`, `tf:${s}:notify_buys`),
      Markup.button.callback(`${f.notify_sells ? on : off} Sells`, `tf:${s}:notify_sells`),
    ],
    [
      Markup.button.callback(`${f.notify_token_creates ? on : off} Creates`, `tf:${s}:notify_token_creates`),
      Markup.button.callback(`${f.notify_transfers ? on : off} Transfers`, `tf:${s}:notify_transfers`),
    ],
    [
      Markup.button.callback('💰 Set Threshold', `st:${s}`),
      ...(f.threshold_value ? [Markup.button.callback('🗑 Clear', `ct:${s}`)] : []),
    ],
    [Markup.button.callback('← Back to Wallets', 'back_to_wallets')],
  ]);
}

function isValidSolanaAddress(addr) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

function parseThresholdInput(text) {
  const clean = text.trim().toLowerCase();
  if (clean === '0' || clean === 'none') return { value: 0, currency: 'USD' };
  const solMatch = clean.match(/^(\d+(?:\.\d+)?)\s*sol$/);
  if (solMatch) return { value: parseFloat(solMatch[1]), currency: 'SOL' };
  const usdMatch = clean.match(/^\$?(\d+(?:\.\d+)?)$/);
  if (usdMatch) return { value: parseFloat(usdMatch[1]), currency: 'USD' };
  return null;
}

export async function sendNotification(text, keyboard = null) {
  try {
    const opts = { parse_mode: 'HTML' };
    if (keyboard) opts.reply_markup = keyboard;
    await bot.telegram.sendMessage(ALLOWED_CHAT, text, opts);
  } catch (err) {
    console.error('Telegram send failed:', err.message);
  }
}

export default bot;
