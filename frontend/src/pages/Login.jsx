import { useState } from "react";
import { api } from "../lib/api";

export default function Login({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } = await api.login(password);
      onLogin(token);
    } catch (err) {
      setError("Invalid password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">◎</div>
        <h1>Solana Tracker</h1>
        <p>Wallet intelligence dashboard</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "..." : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
