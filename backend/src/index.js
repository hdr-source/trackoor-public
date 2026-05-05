import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
dotenv.config();

import webhookRouter from './routes/webhook.js';
import walletsRouter from './routes/wallets.js';
import authRouter from './routes/auth.js';
import bot from './bot/index.js';
import { getRedisClient } from './services/price.js';

const app = express();
const PORT = process.env.PORT || 3001;

let botRunning = false;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));
app.use(express.json({ limit: '10mb' }));

app.use('/webhook', webhookRouter);
app.use('/api/wallets', walletsRouter);
app.use('/api/auth', authRouter);

app.get('/health', async (req, res) => {
  const redis = await getRedisClient();
  res.json({
    ok: true,
    uptime: process.uptime(),
    redis: redis ? 'connected' : 'disconnected',
    bot: botRunning ? 'running' : 'stopped',
  });
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

// Telegraf 4.16+ doesn't reliably resolve bot.launch(), so confirm the bot is up
// by calling getMe() a few seconds after launch instead of awaiting the promise.
if (process.env.NODE_ENV !== 'test') {
  bot.launch()
    .then(() => { botRunning = true; console.log('Telegram bot started'); })
    .catch(err => console.error('Bot launch error:', err.message));

  setTimeout(async () => {
    if (botRunning) return;
    try {
      const me = await bot.telegram.getMe();
      if (me?.id) {
        botRunning = true;
        console.log(`Telegram bot started (${me.username})`);
      }
    } catch { /* health endpoint will report it */ }
  }, 5000);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default app;
