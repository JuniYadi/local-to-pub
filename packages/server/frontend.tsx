import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type TokenRecord = {
  id: number;
  token_hash: string;
  subdomain: string | null;
  created_at: string;
  last_used_at: string | null;
};

type ConnectionRecord = {
  id: number;
  subdomain: string;
  token_id: number;
  connected_at: number;
  disconnected_at: number | null;
};

type InspectorEvent = {
  requestId: string;
  subdomain: string;
  timestamp: number;
  type: "request" | "response";
  method?: string;
  path?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

function shortHash(hash: string): string {
  return hash.substring(0, 12) + "...";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString() + " " + new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(connectedAt: number, disconnectedAt: number | null): string {
  const start = new Date(connectedAt);
  const end = disconnectedAt ? new Date(disconnectedAt) : new Date();
  const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function Inspector() {
  const [events, setEvents] = useState<InspectorEvent[]>([]);

  useEffect(() => {
    const source = new EventSource("/api/inspector/stream");

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as InspectorEvent;
        setEvents((prev) => [data, ...prev].slice(0, 50));
      } catch {
        console.error("Failed to parse inspector event");
      }
    };

    source.onerror = () => {
      console.error("Inspector stream error");
    };

    return () => source.close();
  }, []);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Live Inspector</h2>
        <p>Real-time traffic monitor for all active tunnels.</p>
      </div>
      <div className="panel__body">
        {events.length === 0 && <div className="empty">Waiting for traffic...</div>}
        <ul className="inspector-list">
          {events.map((ev, i) => (
            <li key={`${ev.requestId}-${ev.type}-${i}`} className={`event event--${ev.type}`}>
              <div className="event-header">
                <span className="event-type">{ev.type.toUpperCase()}</span>
                <span className="event-subdomain">{ev.subdomain}</span>
                <span className="event-time">{new Date(ev.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="event-details">
                {ev.type === "request" ? (
                  <>
                    <strong>{ev.method}</strong> {ev.path}
                  </>
                ) : (
                  <>
                    Status: <strong>{ev.status}</strong>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function App() {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingSubdomain, setEditingSubdomain] = useState<{id: number, value: string} | null>(null);
  const [activeTab, setActiveTab] = useState<"tokens" | "inspector" | "connections">("tokens");
  const [connections, setConnections] = useState<{live: ConnectionRecord[], past: ConnectionRecord[]}>({ live: [], past: [] });

  useEffect(() => {
    void loadSession();
  }, []);

  async function loadSession() {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) {
        if (res.status === 500) {
          const data = await res.json().catch(() => ({}));
          if (data.error) {
            setError(data.error);
          }
        }
        setStatus("guest");
        return;
      }
      const data = await res.json();
      setCurrentUser(data.username ?? "");
      setStatus("authed");
      await loadTokens();
    } catch {
      setError("Could not reach the server.");
      setStatus("guest");
    }
  }

  async function loadTokens() {
    try {
      const res = await fetch("/api/tokens");
      if (!res.ok) {
        if (res.status === 401) {
          setStatus("guest");
        }
        return;
      }
      const data = await res.json();
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch {
      setError("Unable to load tokens.");
    }
  }

  async function loadConnections() {
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) return;
      const data = await res.json();
      setConnections({
        live: Array.isArray(data.live) ? data.live : [],
        past: Array.isArray(data.past) ? data.past : [],
      });
    } catch {
      console.error("Failed to load connections");
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNewToken(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput, password: passwordInput }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Login failed.");
        setBusy(false);
        return;
      }
      const data = await res.json();
      setCurrentUser(data.username ?? usernameInput);
      setPasswordInput("");
      setStatus("authed");
      await loadTokens();
      await loadConnections();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setError(null);
    setNewToken(null);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      setStatus("guest");
      setTokens([]);
      setBusy(false);
    }
  }

  async function handleCreateToken() {
    setBusy(true);
    setError(null);
    setNewToken(null);
    try {
      const res = await fetch("/api/tokens", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not create token.");
        setBusy(false);
        return;
      }
      const data = await res.json();
      setNewToken(data.token ?? null);
      await loadTokens();
      await loadConnections();
    } catch {
      setError("Could not create token.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteToken(id: number) {
    if (!confirm("Are you sure you want to delete this token? This action cannot be undone.")) {
      return;
    }
    setBusy(true);
    setError(null);
    setNewToken(null);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Token delete failed.");
        return;
      }
      await loadTokens();
    } catch {
      setError("Token delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateSubdomain(id: number, subdomain: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens/subdomain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, subdomain: subdomain || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not update subdomain.");
        return;
      }
      setEditingSubdomain(null);
      await loadTokens();
      await loadConnections();
    } catch {
      setError("Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
    } catch {
      setError("Copy failed. Please copy manually.");
    }
  }

  return (
    <div className="app">
      <div className="orb orb--one" />
      <div className="orb orb--two" />
      <header className="hero">
        <div>
          <span className="eyebrow">Local-to-Pub Control</span>
          <h1>Token Control Room</h1>
          <p>Secure access to your tunnels. Login to rotate tokens and audit usage.</p>
        </div>
        <div className="hero-card">
          <div className="hero-card__label">Session</div>
          <div className="hero-card__value">
            {status === "loading" ? "Checking..." : status === "authed" ? "Authenticated" : "Locked"}
          </div>
          <div className="hero-card__sub">
            {status === "authed" ? `Signed in as ${currentUser}` : "Admin login required"}
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="panel">
          <div className="panel__header">
            <h2>Admin Access</h2>
            <p>Use your configured credentials to manage tokens.</p>
          </div>
          {status === "loading" && <div className="panel__body">Loading session...</div>}
          {(status === "guest" || status === "loading") && (
            <form className="panel__body form" onSubmit={handleLogin}>
              <label>
                Username
                <input
                  type="text"
                  name="username"
                  value={usernameInput}
                  onChange={(event) => setUsernameInput(event.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  name="password"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "Signing in..." : "Sign In"}
              </button>
            </form>
          )}
          {status === "authed" && (
            <div className="panel__body">
              <div className="action-row">
                <div>
                  <div className="label">Signed in</div>
                  <div className="value">{currentUser}</div>
                </div>
                <button type="button" className="ghost" onClick={handleLogout} disabled={busy}>
                  Logout
                </button>
              </div>
              <div className="token-actions">
                <button type="button" onClick={handleCreateToken} disabled={busy}>
                  {busy ? "Working..." : "Generate New Token"}
                </button>
                <div className="hint">New tokens are shown once. Copy immediately.</div>
              </div>
              {newToken && (
                <div className="new-token">
                  <div>
                    <div className="label">New Token</div>
                    <div className="token-value">{newToken}</div>
                  </div>
                  <button type="button" className="ghost" onClick={handleCopyToken}>
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}
          {error && <div className="panel__error">{error}</div>}
        </section>

        {status === "authed" && (
          <>
            <section className="panel">
              <div className="panel__header">
                <h2>Tunnel Management</h2>
                <p>Manage your tokens and monitor live traffic.</p>
              </div>
              <div className="tabs">
                <button
                  type="button"
                  className={`tab ${activeTab === "tokens" ? "tab--active" : ""}`}
                  onClick={() => setActiveTab("tokens")}
                >
                  Tokens
                </button>
                <button
                  type="button"
                  className={`tab ${activeTab === "inspector" ? "tab--active" : ""}`}
                  onClick={() => setActiveTab("inspector")}
                >
                  Live Inspector
                </button>
                <button
                  type="button"
                  className={`tab ${activeTab === "connections" ? "tab--active" : ""}`}
                  onClick={() => setActiveTab("connections")}
                >
                  Connections
                </button>
              </div>
              <div className="panel__body">
                {activeTab === "tokens" ? (
                  <>
                    {tokens.length === 0 && <div className="empty">No tokens found.</div>}
                    {tokens.length > 0 && (
                      <ul className="token-list">
                        {tokens.map((token, index) => (
                          <li key={token.id} style={{ animationDelay: `${index * 60}ms` }}>
                            <div className="token-row">
                              <div className="token-main">
                                <div className="token-title">Token #{token.id}</div>
                                <div className="token-hash">{shortHash(token.token_hash)}</div>
                                <div className="token-subdomain">
                                  {editingSubdomain?.id === token.id ? (
                                    <div className="subdomain-edit">
                                      <input
                                        type="text"
                                        value={editingSubdomain.value}
                                        onChange={(e) => setEditingSubdomain({ id: token.id, value: e.target.value })}
                                        placeholder="subdomain"
                                      />
                                      <button onClick={() => handleUpdateSubdomain(token.id, editingSubdomain.value)}>Save</button>
                                      <button className="ghost" onClick={() => setEditingSubdomain(null)}>Cancel</button>
                                    </div>
                                  ) : (
                                    <div className="subdomain-display">
                                      {token.subdomain ? (
                                        <span className="badge badge--url">{token.subdomain}</span>
                                      ) : (
                                        <span className="badge">Random</span>
                                      )}
                                      <button className="ghost small" onClick={() => setEditingSubdomain({ id: token.id, value: token.subdomain || "" })}>
                                        Edit
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="token-meta">
                                <span>Created</span>
                                <strong>{formatDate(token.created_at)}</strong>
                              </div>
                              <div className="token-meta">
                                <span>Last used</span>
                                <strong>{formatDate(token.last_used_at)}</strong>
                              </div>
                              <button
                                type="button"
                                className="ghost token-row__delete"
                                onClick={() => void handleDeleteToken(token.id)}
                                disabled={busy}
                              >
                                Delete
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : activeTab === "inspector" ? (
                  <Inspector />
                ) : activeTab === "connections" ? (
                  <>
                    <h3 className="section-title">Live Connections ({connections.live.length})</h3>
                    {connections.live.length === 0 && <div className="empty">No live connections.</div>}
                    {connections.live.length > 0 && (
                      <table className="connections-table">
                        <thead>
                          <tr>
                            <th>Subdomain</th>
                            <th>Token ID</th>
                            <th>Connected</th>
                            <th>Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {connections.live.map((conn) => (
                            <tr key={conn.id}>
                              <td><span className="badge badge--url">{conn.subdomain}</span></td>
                              <td>#{conn.token_id}</td>
                              <td>{formatDate(new Date(conn.connected_at).toISOString())}</td>
                              <td>{formatDuration(conn.connected_at, null)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <h3 className="section-title" style={{ marginTop: "2rem" }}>Past Connections ({connections.past.length})</h3>
                    {connections.past.length === 0 && <div className="empty">No past connections.</div>}
                    {connections.past.length > 0 && (
                      <table className="connections-table">
                        <thead>
                          <tr>
                            <th>Subdomain</th>
                            <th>Token ID</th>
                            <th>Connected</th>
                            <th>Disconnected</th>
                            <th>Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {connections.past.map((conn) => (
                            <tr key={conn.id}>
                              <td><span className="badge badge--url">{conn.subdomain}</span></td>
                              <td>#{conn.token_id}</td>
                              <td>{formatDate(new Date(conn.connected_at).toISOString())}</td>
                              <td>{formatDate(conn.disconnected_at ? new Date(conn.disconnected_at).toISOString() : null)}</td>
                              <td>{formatDuration(conn.connected_at, conn.disconnected_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                ) : null}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
