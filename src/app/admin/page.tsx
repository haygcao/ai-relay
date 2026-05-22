'use client';

import { useState, useEffect } from 'react';
import TokenTrendChart from './components/TokenTrendChart';

interface ProviderInfo {
  name: string;
  id: string;
  keyCount: number;
  availableKeys: number;
  configured: boolean;
  modelPrefixes: string[];
  errors?: Record<string, number>;
  keyErrors?: Array<{
    keyHash: string;
    errors: Record<string, { count: number; reason: string }>;
  }>;
}

interface AdminData {
  status: string;
  timestamp: string;
  providers: ProviderInfo[];
  usage: {
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    providers: Record<string, { requests: number; tokens: number; promptTokens: number; completionTokens: number }>;
  };
  quota: {
    daily: { used: number; limit: number | string };
    monthly: { used: number; limit: number | string };
    allowed: boolean;
  };
  config: {
    dailyLimit: number | null;
    monthlyLimit: number | null;
  };
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);

  // Configuration management states
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerKeys, setProviderKeys] = useState<Array<{ hash: string; masked: string; source: string }> | null>(null);
  const [providerFallbacks, setProviderFallbacks] = useState<{ current: string[]; staticDefault: string | null; staticDefaults: string[]; isOverride: boolean } | null>(null);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [operationLoading, setOperationLoading] = useState(false);
  const [configMessage, setConfigMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [activeFallbacks, setActiveFallbacks] = useState<string[]>([]);
  const [selectedFallbackToAdd, setSelectedFallbackToAdd] = useState('');

  // Automatically select a default value for the fallback-to-add dropdown when options change
  useEffect(() => {
    const available = data?.providers.filter(
      (p) => p.id !== selectedProvider && !activeFallbacks.includes(p.id)
    ) || [];
    if (available.length > 0) {
      if (!available.some(a => a.id === selectedFallbackToAdd)) {
        setSelectedFallbackToAdd(available[0].id);
      }
    } else {
      setSelectedFallbackToAdd('');
    }
  }, [selectedProvider, activeFallbacks, data]);

  // Restore cached API key from localStorage on mount
  useEffect(() => {
    const cached = localStorage.getItem('airelay_admin_key');
    if (cached) {
      setApiKey(cached);
      setLoading(true);
      fetch('/api/admin', {
        headers: { Authorization: `Bearer ${cached}` },
      })
        .then((res) => {
          if (res.status === 401) {
            localStorage.removeItem('airelay_admin_key');
            return;
          }
          return res.json();
        })
        .then((json) => {
          if (json) {
            setData(json);
            setAuthenticated(true);
          }
        })
        .catch(() => {
          localStorage.removeItem('airelay_admin_key');
        })
        .finally(() => setLoading(false));
    }
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401) {
        setError('Invalid API key');
        setAuthenticated(false);
        return;
      }
      const json = await res.json();
      setData(json);
      setAuthenticated(true);
      localStorage.setItem('airelay_admin_key', apiKey);
    } catch (e) {
      setError('Failed to fetch admin data');
    } finally {
      setLoading(false);
    }
  };

  const fetchProviderConfig = async (providerId: string) => {
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const [keysRes, fallbacksRes] = await Promise.all([
        fetch(`/api/admin/providers/${providerId}/keys`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
        fetch(`/api/admin/providers/${providerId}/fallbacks`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      ]);

      if (!keysRes.ok || !fallbacksRes.ok) {
        throw new Error('Failed to fetch provider configuration');
      }

      const keysData = await keysRes.json();
      const fallbacksData = await fallbacksRes.json();

      setProviderKeys(keysData.keys);
      setProviderFallbacks({
        current: fallbacksData.fallbacks,
        staticDefault: fallbacksData.staticDefault,
        staticDefaults: fallbacksData.staticDefaults || [],
        isOverride: fallbacksData.isOverride,
      });
      setActiveFallbacks(fallbacksData.fallbacks || []);
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : 'Failed to load configuration', type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProvider && authenticated) {
      fetchProviderConfig(selectedProvider);
    } else {
      setProviderKeys(null);
      setProviderFallbacks(null);
    }
  }, [selectedProvider, authenticated]);

  const handleAddKey = async () => {
    if (!selectedProvider || !newKeyInput.trim()) return;
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProvider}/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ key: newKeyInput.trim() }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to add key');
      }
      setNewKeyInput('');
      setConfigMessage({ text: 'API Key added successfully', type: 'success' });
      await fetchProviderConfig(selectedProvider);
      await fetchData(); // refresh global key counts
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : 'Failed to add key', type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  };

  const handleDeleteKey = async (hash: string) => {
    if (!selectedProvider) return;
    if (!confirm('Are you sure you want to delete this API Key?')) return;
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProvider}/keys`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ hash }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to delete key');
      }
      setConfigMessage({ text: 'API Key removed successfully', type: 'success' });
      await fetchProviderConfig(selectedProvider);
      await fetchData(); // refresh global key counts
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : 'Failed to delete key', type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  };

  const handleSaveFallbacks = async (newChain: string[]) => {
    if (!selectedProvider) return;
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProvider}/fallbacks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ fallbacks: newChain }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to save fallback chain');
      }
      setConfigMessage({ text: 'Fallback chain saved successfully', type: 'success' });
      await fetchProviderConfig(selectedProvider);
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : 'Failed to save fallback chain', type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  };

  const handleResetFallbacks = async () => {
    if (!selectedProvider) return;
    if (!confirm('Are you sure you want to reset fallbacks to static defaults?')) return;
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProvider}/fallbacks`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to reset fallbacks');
      }
      setConfigMessage({ text: 'Fallback chain reset to default successfully', type: 'success' });
      await fetchProviderConfig(selectedProvider);
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : 'Failed to reset fallbacks', type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated) {
      const interval = setInterval(fetchData, 15000);
      return () => clearInterval(interval);
    }
  }, [authenticated]);

  const fmtNum = (n: number) => n.toLocaleString();
  const fmtTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  if (!authenticated) {
    return (
      <main style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh', padding: '2rem',
      }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>🔐 Admin Login</h1>
        <div style={{
          display: 'flex', gap: '0.5rem', maxWidth: '400px', width: '100%',
        }}>
          <input
            type="password"
            placeholder="Enter RELAY_API_KEY"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchData()}
            style={{
              flex: 1, padding: '0.75rem 1rem', borderRadius: '8px',
              border: '1px solid #333', backgroundColor: '#111', color: '#e0e0e0',
              fontSize: '1rem', outline: 'none',
            }}
          />
          <button
            onClick={fetchData}
            disabled={loading || !apiKey}
            style={{
              padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none',
              backgroundColor: '#2563eb', color: 'white', fontSize: '1rem',
              cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '...' : 'Login'}
          </button>
        </div>
        {error && <p style={{ color: '#ef4444', marginTop: '1rem' }}>{error}</p>}
      </main>
    );
  }

  return (
    <main style={{
      maxWidth: '900px', margin: '0 auto', padding: '2rem',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '2rem',
      }}>
        <h1 style={{ fontSize: '2rem', margin: 0 }}>⚡ AI Relay Admin</h1>
        <button
          onClick={fetchData}
          style={{
            padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #333',
            backgroundColor: 'transparent', color: '#888', cursor: 'pointer',
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Quota Status */}
      <section style={{
        padding: '1.5rem', borderRadius: '12px', border: '1px solid #333',
        backgroundColor: '#111', marginBottom: '1.5rem',
      }}>
        <h2 style={{ fontSize: '1.2rem', marginTop: 0 }}>📊 Quota Status</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>Daily Requests</span>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
              {fmtNum(data!.quota.daily.used)}
              <span style={{ color: '#666', fontSize: '1rem' }}>
                {' / '}{typeof data!.quota.daily.limit === 'number' ? fmtNum(data!.quota.daily.limit) : '∞'}
              </span>
            </div>
          </div>
          <div>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>Monthly Requests</span>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
              {fmtNum(data!.quota.monthly.used)}
              <span style={{ color: '#666', fontSize: '1rem' }}>
                {' / '}{typeof data!.quota.monthly.limit === 'number' ? fmtNum(data!.quota.monthly.limit) : '∞'}
              </span>
            </div>
          </div>
        </div>
        <div style={{
          marginTop: '0.75rem', padding: '0.4rem 0.8rem', borderRadius: '6px',
          display: 'inline-block', fontSize: '0.85rem',
          backgroundColor: data!.quota.allowed ? '#064e3b' : '#7f1d1d',
          color: data!.quota.allowed ? '#34d399' : '#fca5a5',
        }}>
          {data!.quota.allowed ? '✅ Within limits' : '🚫 Rate limited'}
        </div>
      </section>

      {/* Today's Usage */}
      <section style={{
        padding: '1.5rem', borderRadius: '12px', border: '1px solid #333',
        backgroundColor: '#111', marginBottom: '1.5rem',
      }}>
        <h2 style={{ fontSize: '1.2rem', marginTop: 0 }}>📈 Today&apos;s Usage</h2>
        <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>Requests</span>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
              {fmtNum(data!.usage.requests)}
            </div>
          </div>
          <div>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>Total Tokens</span>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
              {fmtTokens(data!.usage.tokens)}
            </div>
          </div>
          <div>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>Prompt Tokens</span>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#60a5fa' }}>
              {fmtTokens(data!.usage.promptTokens || 0)}
            </div>
          </div>
          <div>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>Completion Tokens</span>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#34d399' }}>
              {fmtTokens(data!.usage.completionTokens || 0)}
            </div>
          </div>
        </div>

        {/* Per-provider usage breakdown */}
        {data!.usage.providers && Object.keys(data!.usage.providers).length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', color: '#888', marginBottom: '0.75rem' }}>By Provider</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem', color: '#888' }}>Provider</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', color: '#888' }}>Requests</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', color: '#888' }}>Prompt</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', color: '#888' }}>Completion</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', color: '#888' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data!.usage.providers).map(([name, stats]) => (
                  <tr key={name} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '0.5rem' }}>{name}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{fmtNum(stats.requests)}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', color: '#60a5fa' }}>{fmtTokens(stats.promptTokens)}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', color: '#34d399' }}>{fmtTokens(stats.completionTokens)}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{fmtTokens(stats.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Token Consumption Trend */}
      <TokenTrendChart apiKey={apiKey} />

      {/* Error Statistics */}
      {data!.providers.some((p) => p.errors && Object.keys(p.errors).length > 0) && (
        <section style={{
          padding: '1.5rem', borderRadius: '12px', border: '1px solid #333',
          backgroundColor: '#111', marginBottom: '1.5rem',
        }}>
          <h2 style={{ fontSize: '1.2rem', marginTop: 0 }}>🚨 API Errors (Today)</h2>
          {data!.providers
            .filter((p) => p.errors && Object.keys(p.errors).length > 0)
            .map((p) => (
              <div key={p.id} style={{ marginBottom: '1.2rem' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#f87171' }}>
                  {p.name}
                </div>
                {/* Summary by status code */}
                <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {Object.entries(p.errors!).map(([code, count]) => (
                    <span key={code} style={{
                      padding: '0.25rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem',
                      backgroundColor: code === '429' ? '#78350f' : code.startsWith('4') ? '#7f1d1d' : '#1e1e1e',
                      color: code === '429' ? '#fbbf24' : code.startsWith('4') ? '#fca5a5' : '#888',
                      border: '1px solid #333',
                    }}>
                      HTTP {code}: <strong>{count}</strong> 次
                    </span>
                  ))}
                </div>
                {/* Per-key breakdown */}
                {p.keyErrors && p.keyErrors.length > 0 && (
                  <div style={{ marginLeft: '1rem', fontSize: '0.8rem', color: '#666' }}>
                    {p.keyErrors.map((ke) => (
                      <div key={ke.keyHash} style={{ marginBottom: '0.3rem' }}>
                        <span style={{ fontFamily: 'monospace', color: '#888' }}>
                          key:{ke.keyHash.slice(0, 8)}
                        </span>
                        {Object.entries(ke.errors).map(([code, detail]) => (
                          <span key={code} style={{ marginLeft: '0.8rem' }}>
                            <span style={{ color: '#f87171' }}>{code}×{detail.count}</span>
                            {detail.reason && (
                              <span style={{ color: '#555', marginLeft: '0.3rem' }}>
                                — {detail.reason}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </section>
      )}

      {/* Provider Key Pools */}
      <section style={{
        padding: '1.5rem', borderRadius: '12px', border: '1px solid #333',
        backgroundColor: '#111',
      }}>
        <style dangerouslySetInnerHTML={{ __html: `
          .provider-row {
            transition: all 0.2s ease;
            cursor: pointer;
          }
          .provider-row:hover {
            background-color: #1e1e24 !important;
          }
          .provider-row.selected {
            background-color: #1e293b !important;
            border-left: 3px solid #3b82f6 !important;
          }
          .config-card {
            animation: slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          }
          @keyframes slideDown {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .fallback-item {
            transition: all 0.2s ease;
          }
          .fallback-item:hover {
            background-color: #1a1a24 !important;
          }
        `}} />
        <h2 style={{ fontSize: '1.2rem', marginTop: 0 }}>🔑 Provider Key Pools</h2>
        <p style={{ fontSize: '0.85rem', color: '#888', marginTop: '-0.5rem', marginBottom: '1.2rem' }}>
          Select a provider from the list below to manage its API keys and fallback configuration.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '0.6rem', color: '#888' }}>Provider</th>
              <th style={{ textAlign: 'center', padding: '0.6rem', color: '#888' }}>Status</th>
              <th style={{ textAlign: 'center', padding: '0.6rem', color: '#888' }}>Keys</th>
              <th style={{ textAlign: 'center', padding: '0.6rem', color: '#888' }}>Available</th>
              <th style={{ textAlign: 'left', padding: '0.6rem', color: '#888' }}>Model Prefixes</th>
            </tr>
          </thead>
          <tbody>
            {data!.providers.map((p) => {
              const isSelected = selectedProvider === p.id;
              return (
                <tr
                  key={p.id}
                  className={`provider-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedProvider(isSelected ? null : p.id)}
                  style={{
                    borderBottom: '1px solid #222',
                    backgroundColor: isSelected ? '#1e293b' : 'transparent',
                  }}
                >
                  <td style={{ padding: '0.6rem', fontWeight: 'bold' }}>
                    {isSelected ? '👉 ' : ''}{p.name}
                  </td>
                  <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                    <span style={{
                      padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.8rem',
                      backgroundColor: p.configured ? '#064e3b' : '#7f1d1d',
                      color: p.configured ? '#34d399' : '#fca5a5',
                    }}>
                      {p.configured ? 'OK' : 'NO KEYS'}
                    </span>
                  </td>
                  <td style={{ padding: '0.6rem', textAlign: 'center' }}>{p.keyCount}</td>
                  <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                    <span style={{
                      color: p.availableKeys > 0 ? '#34d399' : '#ef4444',
                      fontWeight: 'bold',
                    }}>
                      {p.availableKeys}
                    </span>
                  </td>
                  <td style={{
                    padding: '0.6rem', fontFamily: 'monospace', fontSize: '0.85rem',
                    color: '#888',
                  }}>
                    {p.modelPrefixes.join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Provider Config Editor Panel */}
      {selectedProvider && (
        <section
          className="config-card"
          style={{
            marginTop: '1.5rem',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid #3b82f6',
            backgroundColor: '#111',
            boxShadow: '0 4px 20px rgba(59, 130, 246, 0.15)',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #333',
            paddingBottom: '1rem',
            marginBottom: '1.5rem',
          }}>
            <div>
              <h2 style={{ fontSize: '1.3rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                ⚙️ Configure {data!.providers.find(p => p.id === selectedProvider)?.name || selectedProvider}
              </h2>
              <span style={{ fontSize: '0.85rem', color: '#888' }}>
                Provider ID: <code style={{ color: '#60a5fa' }}>{selectedProvider}</code>
              </span>
            </div>
            <button
              onClick={() => setSelectedProvider(null)}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #444',
                backgroundColor: 'transparent',
                color: '#aaa',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Close
            </button>
          </div>

          {/* Config Loading / Message */}
          {operationLoading && !providerKeys && !providerFallbacks && (
            <div style={{ color: '#888', textAlign: 'center', padding: '2rem' }}>
              Loading configuration...
            </div>
          )}

          {configMessage && (
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
              border: configMessage.type === 'success' ? '1px solid #059669' : '1px solid #dc2626',
              backgroundColor: configMessage.type === 'success' ? 'rgba(5, 150, 105, 0.1)' : 'rgba(220, 38, 38, 0.1)',
              color: configMessage.type === 'success' ? '#34d399' : '#f87171',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>{configMessage.text}</span>
              <button
                onClick={() => setConfigMessage(null)}
                style={{
                  background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.2rem', padding: '0 0.5rem'
                }}
              >
                ×
              </button>
            </div>
          )}

          {/* Core Configuration Content */}
          {(providerKeys || providerFallbacks) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: '2rem',
            }}>

              {/* Column 1: API Key Pool */}
              <div>
                <h3 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '0.75rem', color: '#e0e0e0' }}>
                  🔑 API Key Pool
                </h3>

                {/* Overriding Info Warning */}
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(245, 158, 11, 0.05)',
                  border: '1px solid rgba(245, 158, 11, 0.2)',
                  color: '#fbbf24',
                  fontSize: '0.85rem',
                  lineHeight: '1.4',
                  marginBottom: '1rem',
                }}>
                  {providerKeys && providerKeys.length > 0 && providerKeys[0].source === 'managed' ? (
                    <span>
                      ⚠️ <strong>KV key pool active:</strong> These keys override local environment variables (<code>.env.local</code>) for this provider.
                    </span>
                  ) : (
                    <span>
                      💡 Currently using keys defined in local environment variables (<code>.env.local</code>). Adding a key below will store it in KV and override the environment variable pool.
                    </span>
                  )}
                </div>

                {/* Add Key Form */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  <input
                    type="password"
                    placeholder="Enter raw API key"
                    value={newKeyInput}
                    onChange={(e) => setNewKeyInput(e.target.value)}
                    disabled={operationLoading}
                    style={{
                      flex: 1,
                      padding: '0.6rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid #333',
                      backgroundColor: '#18181b',
                      color: '#fff',
                      fontSize: '0.9rem',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleAddKey}
                    disabled={operationLoading || !newKeyInput.trim()}
                    style={{
                      padding: '0.6rem 1rem',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: '#2563eb',
                      color: 'white',
                      fontWeight: 'bold',
                      fontSize: '0.9rem',
                      cursor: operationLoading || !newKeyInput.trim() ? 'not-allowed' : 'pointer',
                      opacity: operationLoading || !newKeyInput.trim() ? 0.6 : 1,
                    }}
                  >
                    Add
                  </button>
                </div>

                {/* Keys list */}
                <div style={{
                  border: '1px solid #222',
                  borderRadius: '8px',
                  backgroundColor: '#0a0a0c',
                  maxHeight: '250px',
                  overflowY: 'auto',
                }}>
                  {providerKeys && providerKeys.length > 0 ? (
                    providerKeys.map((key) => {
                      const isEnv = key.source === 'env';
                      return (
                        <div
                          key={key.hash}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.6rem 0.8rem',
                            borderBottom: '1px solid #1c1c1f',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <code style={{ fontSize: '0.9rem', color: '#e0e0e0', fontFamily: 'monospace' }}>
                              {key.masked}
                            </code>
                            <span style={{ fontSize: '0.75rem', color: '#666' }}>
                              Hash: <code>{key.hash.slice(0, 8)}</code>
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              fontSize: '0.75rem',
                              padding: '0.15rem 0.4rem',
                              borderRadius: '4px',
                              backgroundColor: isEnv ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                              color: isEnv ? '#60a5fa' : '#34d399',
                              border: isEnv ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid rgba(16, 185, 129, 0.2)',
                            }}>
                              {isEnv ? 'env' : 'kv'}
                            </span>

                            <button
                              onClick={() => handleDeleteKey(key.hash)}
                              disabled={operationLoading || isEnv}
                              style={{
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                border: '1px solid #dc2626',
                                backgroundColor: 'transparent',
                                color: '#ef4444',
                                fontSize: '0.75rem',
                                cursor: operationLoading || isEnv ? 'not-allowed' : 'pointer',
                                opacity: isEnv ? 0.4 : 1,
                              }}
                              title={isEnv ? 'Environment keys must be deleted from .env.local file' : 'Remove key'}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ color: '#555', fontSize: '0.9rem', padding: '1.5rem', textAlign: 'center' }}>
                      No API keys configured. Requests will fail.
                    </div>
                  )}
                </div>
              </div>

              {/* Column 2: Fallback Chain */}
              <div>
                <h3 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '0.75rem', color: '#e0e0e0' }}>
                  🔗 Fallback Chain
                </h3>

                {/* Static / Managed indicator */}
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(59, 130, 246, 0.05)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  color: '#60a5fa',
                  fontSize: '0.85rem',
                  lineHeight: '1.4',
                  marginBottom: '1rem',
                }}>
                  {providerFallbacks?.isOverride ? (
                    <span>
                      🟢 <strong>KV fallback chain active:</strong> Custom priority chain is stored in KV.
                    </span>
                  ) : (
                    <span>
                      ⚪ Using <strong>static defaults:</strong> Defined in system config files.
                    </span>
                  )}
                </div>

                {/* Reorderable Chain List */}
                <div style={{
                  border: '1px solid #222',
                  borderRadius: '8px',
                  backgroundColor: '#0a0a0c',
                  marginBottom: '1rem',
                  padding: '0.25rem 0',
                }}>
                  {activeFallbacks.length > 0 ? (
                    activeFallbacks.map((fbId, idx) => {
                      const fbName = data?.providers.find(p => p.id === fbId)?.name || fbId;
                      return (
                        <div
                          key={`${fbId}-${idx}`}
                          className="fallback-item"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.5rem 0.8rem',
                            borderBottom: idx < activeFallbacks.length - 1 ? '1px solid #1c1c1f' : 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              color: '#666',
                              fontSize: '0.8rem',
                              fontFamily: 'monospace',
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              backgroundColor: '#1c1c1f',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}>{idx + 1}</span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{fbName}</span>
                            <span style={{ fontSize: '0.75rem', color: '#555', fontFamily: 'monospace' }}>({fbId})</span>
                          </div>

                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            {/* Up button */}
                            <button
                              onClick={() => {
                                if (idx === 0) return;
                                const nextList = [...activeFallbacks];
                                const tmp = nextList[idx];
                                nextList[idx] = nextList[idx - 1];
                                nextList[idx - 1] = tmp;
                                setActiveFallbacks(nextList);
                              }}
                              disabled={idx === 0 || operationLoading}
                              style={{
                                padding: '0.2rem 0.4rem',
                                borderRadius: '4px',
                                border: '1px solid #333',
                                backgroundColor: '#18181b',
                                color: '#aaa',
                                fontSize: '0.75rem',
                                cursor: idx === 0 || operationLoading ? 'not-allowed' : 'pointer',
                              }}
                            >
                              ▲
                            </button>
                            {/* Down button */}
                            <button
                              onClick={() => {
                                if (idx === activeFallbacks.length - 1) return;
                                const nextList = [...activeFallbacks];
                                const tmp = nextList[idx];
                                nextList[idx] = nextList[idx + 1];
                                nextList[idx + 1] = tmp;
                                setActiveFallbacks(nextList);
                              }}
                              disabled={idx === activeFallbacks.length - 1 || operationLoading}
                              style={{
                                padding: '0.2rem 0.4rem',
                                borderRadius: '4px',
                                border: '1px solid #333',
                                backgroundColor: '#18181b',
                                color: '#aaa',
                                fontSize: '0.75rem',
                                cursor: idx === activeFallbacks.length - 1 || operationLoading ? 'not-allowed' : 'pointer',
                              }}
                            >
                              ▼
                            </button>
                            {/* Remove button */}
                            <button
                              onClick={() => {
                                const nextList = activeFallbacks.filter((_, i) => i !== idx);
                                setActiveFallbacks(nextList);
                              }}
                              disabled={operationLoading}
                              style={{
                                padding: '0.2rem 0.4rem',
                                borderRadius: '4px',
                                border: '1px solid #7f1d1d',
                                backgroundColor: 'transparent',
                                color: '#f87171',
                                fontSize: '0.75rem',
                                cursor: operationLoading ? 'not-allowed' : 'pointer',
                              }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ color: '#555', fontSize: '0.9rem', padding: '1.5rem', textAlign: 'center' }}>
                      No fallbacks. Fails immediately on error.
                    </div>
                  )}
                </div>

                {/* Add Fallback Form */}
                {data && data.providers.filter(p => p.id !== selectedProvider && !activeFallbacks.includes(p.id)).length > 0 ? (
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                    <select
                      value={selectedFallbackToAdd}
                      onChange={(e) => setSelectedFallbackToAdd(e.target.value)}
                      disabled={operationLoading}
                      style={{
                        flex: 1,
                        padding: '0.5rem 0.8rem',
                        borderRadius: '6px',
                        border: '1px solid #333',
                        backgroundColor: '#18181b',
                        color: '#fff',
                        fontSize: '0.85rem',
                        outline: 'none',
                      }}
                    >
                      {data.providers
                        .filter(p => p.id !== selectedProvider && !activeFallbacks.includes(p.id))
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.id})
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => {
                        if (!selectedFallbackToAdd) return;
                        setActiveFallbacks([...activeFallbacks, selectedFallbackToAdd]);
                      }}
                      disabled={operationLoading || !selectedFallbackToAdd}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '6px',
                        border: '1px solid #444',
                        backgroundColor: '#1c1c1f',
                        color: '#eee',
                        fontSize: '0.85rem',
                        cursor: operationLoading || !selectedFallbackToAdd ? 'not-allowed' : 'pointer',
                      }}
                    >
                      + Add
                    </button>
                  </div>
                ) : (
                  <div style={{ color: '#555', fontSize: '0.8rem', marginBottom: '1.5rem', textAlign: 'center' }}>
                    No other providers available to add.
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  {providerFallbacks?.isOverride && (
                    <button
                      onClick={handleResetFallbacks}
                      disabled={operationLoading}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '6px',
                        border: '1px solid #7f1d1d',
                        backgroundColor: 'transparent',
                        color: '#f87171',
                        fontSize: '0.9rem',
                        cursor: operationLoading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Reset to Default
                    </button>
                  )}
                  <button
                    onClick={() => handleSaveFallbacks(activeFallbacks)}
                    disabled={operationLoading || JSON.stringify(activeFallbacks) === JSON.stringify(providerFallbacks?.current)}
                    style={{
                      padding: '0.5rem 1.25rem',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: '#2563eb',
                      color: 'white',
                      fontWeight: 'bold',
                      fontSize: '0.9rem',
                      cursor: operationLoading || JSON.stringify(activeFallbacks) === JSON.stringify(providerFallbacks?.current) ? 'not-allowed' : 'pointer',
                      opacity: operationLoading || JSON.stringify(activeFallbacks) === JSON.stringify(providerFallbacks?.current) ? 0.6 : 1,
                    }}
                  >
                    Save Chain
                  </button>
                </div>
              </div>

            </div>
          )}
        </section>
      )}

      <p style={{
        color: '#555', marginTop: '2rem', fontSize: '0.8rem', textAlign: 'center',
      }}>
        Auto-refreshes every 15s · Data as of {new Date(data!.timestamp).toLocaleTimeString()}
      </p>
    </main>
  );
}
