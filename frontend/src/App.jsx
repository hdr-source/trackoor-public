import { useState, useEffect } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("tracker_token"));

  const handleLogin = (t) => {
    localStorage.setItem("tracker_token", t);
    setToken(t);
  };

  const handleLogout = () => {
    localStorage.removeItem("tracker_token");
    setToken(null);
  };

  if (!token) return <Login onLogin={handleLogin} />;
  return <Dashboard token={token} onLogout={handleLogout} />;
}
