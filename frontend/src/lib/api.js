const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function request(path, options = {}, token) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  login: (password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),

  getWallets: (token) => request('/api/wallets', {}, token),
  
  addWallet: (token, address, label) =>
    request('/api/wallets', { method: 'POST', body: JSON.stringify({ address, label }) }, token),

  deleteWallet: (token, address) =>
    request(`/api/wallets/${address}`, { method: 'DELETE' }, token),

  updateLabel: (token, address, label) =>
    request(`/api/wallets/${address}/label`, { method: 'PATCH', body: JSON.stringify({ label }) }, token),

  updateFilters: (token, address, filters) =>
    request(`/api/wallets/${address}/filters`, { method: 'PATCH', body: JSON.stringify(filters) }, token),

  toggleWallet: (token, address) =>
    request(`/api/wallets/${address}/toggle`, { method: 'PATCH' }, token),

  getTransactions: (token, address, limit = 50) =>
    request(`/api/wallets/${address}/transactions?limit=${limit}`, {}, token),

  getStats: (token) => request('/api/wallets/stats/overview', {}, token),
};
