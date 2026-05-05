import express from 'express';
import { generateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  res.json({ token: generateToken() });
});

export default router;
