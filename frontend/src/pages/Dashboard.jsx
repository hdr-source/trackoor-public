import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

const shorten = (addr) => addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "";
const formatUSD = (n) => n == null ? "" : `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatSOL = (n) => n == null ? "" : `${parseFloat(n).toFixed(3)} SOL`;

function FilterBadge({ on, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`filter-badge ${on ? "on" : "off"}`}
    >
      {on ? "✓" : "×"} {label}
    </button>
  );
}

function ThresholdEditor({ filters, onChange }) {
  const [value, setValue] = useState(filters?.threshold_value || "");
  const [currency, setCurrency] = useState(filters?.threshold_currency || "USD");

  const handleSave = () => {
    onChange({
      threshold_value: value === "" ? null : parseFloat(value),
      threshold_currency: currency,
    });
  };

  return (
    <div className="threshold-editor">
      <label>Min trade size</label>
      <div className="threshold-row">
        <input
          type="number"
          placeholder="None"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min="0"
        />
        <div className="currency-toggle">
          <button
            className={currency === "USD" ? "active" : ""}
            onClick={() => setCurrency("USD")}
          >USD</button>
          <button
            className={currency === "SOL" ? "active" : ""}
            onClick={() => setCurrency("SOL")}
          >SOL</button>
        </div>
        <button className="save-btn" onClick={handleSave}>Save</button>
      </div>
    </div>
  );
}

function WalletCard({ wallet, token, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState(wallet.label || "");
  const [loading, setLoading] = useState(false);
  const [txs, setTxs] = useState(null);
  const [showTxs, setShowTxs] = useState(false);

  const f = wallet.filters || {};
  const label = wallet.label || shorten(wallet.address);

  const handleToggleFilter = async (field) => {
    const updated = { [field]: !f[field] };
    await api.updateFilters(token, wallet.address, updated);
    onUpdate();
  };

  const handleThresholdChange = async (threshold) => {
    await api.updateFilters(token, wallet.address, threshold);
    onUpdate();
  };

  const handleLabelSave = async () => {
    await api.updateLabel(token, wallet.address, labelInput);
    setEditingLabel(false);
    onUpdate();
  };

  const handleToggleActive = async () => {
    setLoading(true);
    await api.toggleWallet(token, wallet.address);
    onUpdate();
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete wallet ${label}?`)) return;
    await api.deleteWallet(token, wallet.address);
    onDelete();
  };

  const loadTxs = async () => {
    if (txs) { setShowTxs(!showTxs); return; }
    const data = await api.getTransactions(token, wallet.address, 20);
    setTxs(data);
    setShowTxs(true);
  };

  const threshold = f.threshold_value
    ? `${f.threshold_value} ${f.threshold_currency}`
    : null;

  return (
    <div className={`wallet-card ${!wallet.active ? "paused" : ""}`}>
      <div className="wallet-header" onClick={() => setExpanded(!expanded)}>
        <div className="wallet-info">
          <div className="wallet-status-dot" style={{ background: wallet.active ? "#22c55e" : "#6b7280" }} />
          <div>
            {editingLabel ? (
              <span className="label-edit" onClick={(e) => e.stopPropagation()}>
                <input
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLabelSave()}
                  autoFocus
                />
                <button onClick={handleLabelSave}>✓</button>
                <button onClick={() => setEditingLabel(false)}>×</button>
              </span>
            ) : (
              <div className="wallet-label" onClick={(e) => { e.stopPropagation(); setEditingLabel(true); }}>
                {label} <span className="edit-hint">✏</span>
              </div>
            )}
            <div className="wallet-address">{shorten(wallet.address)}</div>
          </div>
        </div>
        <div className="wallet-badges">
          {f.notify_buys && <span className="type-badge buy">B</span>}
          {f.notify_sells && <span className="type-badge sell">S</span>}
          {f.notify_token_creates && <span className="type-badge create">C</span>}
          {f.notify_transfers && <span className="type-badge transfer">T</span>}
          {threshold && <span className="threshold-badge">≥{threshold}</span>}
          <span className="expand-arrow">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="wallet-expanded">
          <div className="filter-section">
            <label className="section-label">Notify on</label>
            <div className="filter-badges">
              <FilterBadge on={f.notify_buys} label="Buys" onClick={() => handleToggleFilter("notify_buys")} />
              <FilterBadge on={f.notify_sells} label="Sells" onClick={() => handleToggleFilter("notify_sells")} />
              <FilterBadge on={f.notify_token_creates} label="Token Creates" onClick={() => handleToggleFilter("notify_token_creates")} />
              <FilterBadge on={f.notify_transfers} label="Transfers" onClick={() => handleToggleFilter("notify_transfers")} />
            </div>
          </div>

          <ThresholdEditor filters={f} onChange={handleThresholdChange} />

          <div className="wallet-address-full">
            <span>{wallet.address}</span>
            <button onClick={() => navigator.clipboard.writeText(wallet.address)}>Copy</button>
          </div>

          <div className="wallet-actions">
            <button className="action-btn secondary" onClick={handleToggleActive} disabled={loading}>
              {wallet.active ? "⏸ Pause" : "▶ Resume"}
            </button>
            <button className="action-btn secondary" onClick={loadTxs}>
              📋 History
            </button>
            <button className="action-btn danger" onClick={handleDelete}>
              🗑 Delete
            </button>
          </div>

          {showTxs && txs && (
            <div className="tx-history">
              <label className="section-label">Recent Transactions</label>
              {txs.length === 0 && <p className="empty">No transactions yet</p>}
              {txs.map((tx) => (
                <div key={tx.id} className="tx-row">
                  <span className={`tx-direction ${tx.direction?.toLowerCase() || tx.tx_type?.toLowerCase()}`}>
                    {tx.direction || tx.tx_type}
                  </span>
                  <span className="tx-token">{tx.token_symbol || "SOL"}</span>
                  <span className="tx-amount">{tx.usd_value ? formatUSD(tx.usd_value) : formatSOL(tx.sol_amount)}</span>
                  <span className="tx-dex">{tx.dex}</span>
                  <a
                    href={`https://solscan.io/tx/${tx.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="tx-link"
                  >↗</a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddWalletModal({ token, onAdd, onClose }) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const isValid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid) { setError("Invalid Solana address"); return; }
    setLoading(true);
    setError(null);
    try {
      await api.addWallet(token, address.trim(), label.trim() || null);
      onAdd();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Wallet</h2>
          <button onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Wallet Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Solana wallet address"
              autoFocus
              className={address && !isValid ? "invalid" : ""}
            />
            {address && !isValid && <span className="field-error">Invalid address</span>}
          </div>
          <div className="field">
            <label>Label (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Smart Money #1"
            />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="action-btn secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="action-btn primary" disabled={!isValid || loading}>
              {loading ? "Adding..." : "Add Wallet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div className="stats-bar">
      <div className="stat">
        <span className="stat-value">{stats.active_wallets}</span>
        <span className="stat-label">Active Wallets</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.notifications_24h}</span>
        <span className="stat-label">Alerts (24h)</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.txs_24h}</span>
        <span className="stat-label">Transactions (24h)</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.txs_30d}</span>
        <span className="stat-label">Transactions (30d)</span>
      </div>
    </div>
  );
}

export default function Dashboard({ token, onLogout }) {
  const [wallets, setWallets] = useState([]);
  const [stats, setStats] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | active | paused

  const load = useCallback(async () => {
    try {
      const [w, s] = await Promise.all([
        api.getWallets(token),
        api.getStats(token),
      ]);
      setWallets(w);
      setStats(s);
    } catch (err) {
      if (err.message === "Invalid token") onLogout();
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Poll every 30s — webhook activity may have updated wallets/tx counts
  // since the last render. Cheap enough to brute-force re-fetch.
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = wallets.filter((w) => {
    const matchSearch = !search ||
      w.address.toLowerCase().includes(search.toLowerCase()) ||
      (w.label || "").toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === "all" ||
      (filter === "active" && w.active) ||
      (filter === "paused" && !w.active);
    return matchSearch && matchFilter;
  });

  return (
    <div className="dashboard">
      <header className="header">
        <div className="header-left">
          <span className="logo">◎</span>
          <h1>Solana Tracker</h1>
        </div>
        <div className="header-right">
          <button className="add-btn" onClick={() => setShowAdd(true)}>+ Add Wallet</button>
          <button className="logout-btn" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <main className="main">
        <StatsBar stats={stats} />

        <div className="controls">
          <input
            className="search-input"
            placeholder="Search wallets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="filter-tabs">
            {["all", "active", "paused"].map((f) => (
              <button
                key={f}
                className={`tab ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <span className="wallet-count">{filtered.length} wallet{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        {loading && <div className="loading">Loading...</div>}

        {!loading && filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <h2>No wallets yet</h2>
            <p>Add your first wallet to start tracking</p>
            <button className="add-btn" onClick={() => setShowAdd(true)}>+ Add Wallet</button>
          </div>
        )}

        <div className="wallet-list">
          {filtered.map((wallet) => (
            <WalletCard
              key={wallet.id}
              wallet={wallet}
              token={token}
              onUpdate={load}
              onDelete={load}
            />
          ))}
        </div>
      </main>

      {showAdd && (
        <AddWalletModal
          token={token}
          onAdd={() => { setShowAdd(false); load(); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
