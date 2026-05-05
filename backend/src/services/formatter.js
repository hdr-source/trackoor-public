export function formatSwapMessage(wallet, parsedTx, pnl, solPrice) {
  const { direction, token_symbol, token_amount, sol_amount, usd_value, dex } = parsedTx;
  const label = wallet.label || shortenAddress(wallet.address);
  const usd = usd_value || (sol_amount * solPrice);
  const emoji = direction === 'BUY' ? '🟢' : '🔴';
  const dirLabel = direction === 'BUY' ? 'Bought' : 'Sold';

  let msg = `👛 <b>${label}</b>\n`;
  msg += `${emoji} ${dirLabel} <b>${formatNumber(token_amount)} ${token_symbol || 'UNKNOWN'}</b>\n`;
  msg += `💰 ${formatSOL(sol_amount)} SOL (<b>$${formatUSD(usd)}</b>)\n`;
  msg += `📍 ${formatDex(dex)}\n`;

  if (direction === 'SELL' && pnl) {
    const pnlEmoji = pnl.realized_pnl_sol >= 0 ? '📈' : '📉';
    const solSign = pnl.realized_pnl_sol >= 0 ? '+' : '';
    const usdSign = pnl.realized_pnl_usd >= 0 ? '+' : '';
    msg += `${pnlEmoji} PNL: <b>${solSign}${formatSOL(pnl.realized_pnl_sol)} SOL (${usdSign}$${formatUSD(pnl.realized_pnl_usd)})</b>`;
    if (pnl.pnl_percent !== 0) msg += ` ${usdSign}${pnl.pnl_percent.toFixed(0)}%`;
    msg += '\n';
  }

  msg += `\n<code>${wallet.address}</code>`;
  return msg;
}

export function formatTokenCreateMessage(wallet, parsedTx) {
  const label = wallet.label || shortenAddress(wallet.address);
  const symbol = parsedTx.token_symbol || 'Unknown Token';
  let msg = `👛 <b>${label}</b>\n🚀 <b>Created Token: ${symbol}</b>\n`;
  if (parsedTx.token_address) msg += `📋 <code>${parsedTx.token_address}</code>\n`;
  msg += `\n<code>${wallet.address}</code>`;
  return msg;
}

export function formatTransferMessage(wallet, parsedTx, solPrice) {
  const label = wallet.label || shortenAddress(wallet.address);
  const dirEmoji = parsedTx.direction === 'IN' ? '📥' : '📤';
  const dirLabel = parsedTx.direction === 'IN' ? 'Received' : 'Sent';

  let msg = `👛 <b>${label}</b>\n`;

  if (parsedTx.token_address && parsedTx.token_amount) {
    const symbol = parsedTx.token_symbol || 'UNKNOWN';
    msg += `${dirEmoji} ${dirLabel}: <b>${formatNumber(parsedTx.token_amount)} ${symbol}</b>\n`;
    if (parsedTx.sol_amount > 0) {
      msg += `💰 ${formatSOL(parsedTx.sol_amount)} SOL ($${formatUSD(parsedTx.sol_amount * solPrice)})\n`;
    }
  } else {
    const solAmt = parsedTx.sol_amount || 0;
    msg += `${dirEmoji} ${dirLabel}: <b>${formatSOL(solAmt)} SOL ($${formatUSD(solAmt * solPrice)})</b>\n`;
  }

  msg += `\n<code>${wallet.address}</code>`;
  return msg;
}

export function getNotificationKeyboard(walletAddress, tokenAddress, signature) {
  const s = walletAddress.slice(0, 8);
  const chartUrl = tokenAddress ? `https://gmgn.ai/sol/token/${tokenAddress}` : 'https://gmgn.ai/sol';
  const txUrl = signature ? `https://solscan.io/tx/${signature}` : 'https://solscan.io';
  return {
    inline_keyboard: [
      [{ text: '🔗 Chart', url: chartUrl }, { text: '📝 Tx', url: txUrl }],
      [
        { text: '⚙️ Filters', callback_data: `e:${s}` },
        { text: '⏸ Pause', callback_data: `p:${s}` },
      ],
    ],
  };
}

function shortenAddress(addr) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatDex(dex) {
  const map = { PUMP_FUN: 'PumpFun', RAYDIUM: 'Raydium', ORCA: 'Orca', JUPITER: 'Jupiter', METEORA: 'Meteora' };
  return map[dex] || dex || 'Unknown DEX';
}

function formatNumber(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

function formatSOL(n) {
  return n ? parseFloat(n).toFixed(3) : '0';
}

function formatUSD(n) {
  return n
    ? parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
}
