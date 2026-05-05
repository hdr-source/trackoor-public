import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getAllWallets,
  addWallet,
  deleteWallet,
  updateWalletFilters,
  updateWalletLabel,
  toggleWallet,
  getWalletByAddress,
} from '../services/wallet.js';
import { query } from '../db/index.js';

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    res.json(await getAllWallets());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { address, label } = req.body;
    if (!address) return res.status(400).json({ error: 'Address required' });
    res.status(201).json(await addWallet(address, label));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:address', async (req, res) => {
  try {
    await deleteWallet(req.params.address);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:address/label', async (req, res) => {
  try {
    await updateWalletLabel(req.params.address, req.body.label);
    res.json(await getWalletByAddress(req.params.address));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:address/filters', async (req, res) => {
  try {
    await updateWalletFilters(req.params.address, req.body);
    res.json(await getWalletByAddress(req.params.address));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:address/toggle', async (req, res) => {
  try {
    res.json({ active: await toggleWallet(req.params.address) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:address/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await query(
      `SELECT * FROM transactions
       WHERE wallet_address = $1
       ORDER BY tx_timestamp DESC
       LIMIT $2`,
      [req.params.address, limit]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/overview', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM wallets WHERE active = true) as active_wallets,
        (SELECT COUNT(*) FROM transactions WHERE created_at > NOW() - INTERVAL '24h') as txs_24h,
        (SELECT COUNT(*) FROM transactions WHERE notified = true AND created_at > NOW() - INTERVAL '24h') as notifications_24h,
        (SELECT COUNT(*) FROM transactions WHERE created_at > NOW() - INTERVAL '30d') as txs_30d
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
