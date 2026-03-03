import { useState, useEffect, useMemo, useCallback, useRef } from "react";

const C = {
  bg0: "#08090c", bg1: "#0c0d11", bg2: "#101219", bg3: "#151720",
  surface: "#181a24", surfaceHover: "#1c1e2a",
  border: "#1e2030", borderLight: "#262840",
  text: "#d1d5e8", textSoft: "#8b90a8", textMuted: "#505470", textGhost: "#353850",
  accent: "#34d399", accentBg: "#34d39910",
  red: "#f87171", redBg: "#f8717110",
  amber: "#fbbf24", amberBg: "#fbbf2410",
  blue: "#60a5fa", purple: "#a78bfa", white: "#eef0ff",
  fontMono: "'Geist Mono', 'JetBrains Mono', 'SF Mono', monospace",
  fontSans: "'Geist', 'DM Sans', -apple-system, sans-serif",
};

const fmt = (n) => {
  if (!n && n !== 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtPct = (n) => (!n && n !== 0) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const fmtAge = (ts) => { if (!ts) return "—"; const m = Math.floor((Date.now() - ts) / 60000); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d`; };

const CHAINS = { solana: { label: "SOL", color: "#9945FF" }, ethereum: { label: "ETH", color: "#627EEA" }, base: { label: "BASE", color: "#0052FF" }, bsc: { label: "BSC", color: "#F3BA2F" }, arbitrum: { label: "ARB", color: "#28A0F0" } };

const DEX = "https://api.dexscreener.com";

async function fetchNewPairs(chain) {
  try {
    const res = await fetch(`${DEX}/token-profiles/latest/v1`);
    if (!res.ok) throw new Error(`${res.status}`);
    const profiles = await res.json();
    const filtered = profiles.filter(p => p.chainId === chain).slice(0, 20);
    if (!filtered.length) return [];
    const addrs = filtered.map(p => p.tokenAddress);
    const chunks = [];
    for (let i = 0; i < addrs.length; i += 30) chunks.push(addrs.slice(i, i + 30));
    let all = [];
    for (const ch of chunks) {
      const r = await fetch(`${DEX}/tokens/v1/${chain}/${ch.join(",")}`);
      if (r.ok) { const d = await r.json(); if (Array.isArray(d)) all = all.concat(d); }
    }
    return all;
  } catch (e) { console.error(e); return []; }
}

async function fetchBoosted() {
  try { const r = await fetch(`${DEX}/token-boosts/latest/v1`); return r.ok ? await r.json() : []; }
  catch { return []; }
}

async function searchTokens(q) {
  try { const r = await fetch(`${DEX}/latest/dex/search?q=${encodeURIComponent(q)}`); const d = await r.json(); return d.pairs || []; }
  catch { return []; }
}

function norm(p) {
  const bt = p.baseToken || {}, qt = p.quoteToken || {}, tx = p.txns || {}, v = p.volume || {}, pc = p.priceChange || {}, lq = p.liquidity || {}, info = p.info || {};
  const b5 = tx.m5?.buys || 0, s5 = tx.m5?.sells || 0, b1 = tx.h1?.buys || 0, s1 = tx.h1?.sells || 0, b24 = tx.h24?.buys || 0, s24 = tx.h24?.sells || 0;
  const t5 = b5 + s5, t1 = b1 + s1;
  return {
    id: p.pairAddress || Math.random().toString(36).slice(2),
    name: bt.symbol ? `$${bt.symbol}` : "???", fullName: bt.name || "",
    address: bt.address || "", pairAddress: p.pairAddress || "", chain: p.chainId || "solana", dex: p.dexId || "",
    mc: p.marketCap || p.fdv || 0, fdv: p.fdv || 0, liq: lq.usd || 0, price: parseFloat(p.priceUsd) || 0,
    age: p.pairCreatedAt || 0, vol5m: v.m5 || 0, vol1h: v.h1 || 0, vol6h: v.h6 || 0, vol24h: v.h24 || 0,
    pc5m: pc.m5 || 0, pc1h: pc.h1 || 0, pc6h: pc.h6 || 0, pc24h: pc.h24 || 0,
    buys5m: b5, sells5m: s5, buys1h: b1, sells1h: s1, buys24h: b24, sells24h: s24,
    buyPct5m: t5 > 0 ? b5 / t5 * 100 : 50, buyPct1h: t1 > 0 ? b1 / t1 * 100 : 50,
    txns5m: t5, txns1h: t1, txns24h: b24 + s24, quoteSymbol: qt.symbol || "SOL",
    imgUrl: info.imageUrl || null, websites: info.websites || [], socials: info.socials || [],
    boosts: p.boosts?.active || 0,
  };
}

/* ═══ MICRO COMPONENTS ═══ */
const ChainPill = ({ chain }) => { const m = CHAINS[chain] || { label: "?", color: "#666" }; return <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, color: m.color, fontFamily: C.fontMono }}>{m.label}</span>; };

const Delta = ({ val, sz = 11 }) => {
  if (val === null || val === undefined || isNaN(val)) return <span style={{ color: C.textMuted, fontSize: sz, fontFamily: C.fontMono }}>—</span>;
  return <span style={{ fontSize: sz, fontWeight: 600, color: val > 0 ? C.accent : val < 0 ? C.red : C.textMuted, fontFamily: C.fontMono }}>{fmtPct(val)}</span>;
};

const BSBar = ({ pct, w = 44 }) => {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: w, height: 3, borderRadius: 1, background: C.redBg, overflow: "hidden" }}>
        <div style={{ width: `${p}%`, height: "100%", background: p > 60 ? C.accent : p > 45 ? C.amber : C.red, opacity: 0.65 }} />
      </div>
      <span style={{ fontSize: 9, fontFamily: C.fontMono, color: p > 60 ? C.accent : p > 45 ? C.textSoft : C.red, fontWeight: 500, minWidth: 18 }}>{p.toFixed(0)}</span>
    </div>
  );
};

const Stat = ({ label, value, warn, danger, accent: isAcc }) => (
  <div>
    <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 0.8, fontWeight: 500, fontFamily: C.fontMono, marginBottom: 3, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: C.fontMono, color: danger ? C.red : warn ? C.amber : isAcc ? C.accent : C.white, lineHeight: 1 }}>{value}</div>
  </div>
);

const SH = ({ children }) => <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, color: C.textMuted, fontFamily: C.fontMono, textTransform: "uppercase", marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{children}</div>;

/* ═══ DETAIL PANEL ═══ */
const Detail = ({ token: t, onClose }) => {
  if (!t) return null;
  const lmr = t.mc > 0 ? t.liq / t.mc * 100 : 0;
  const vmr = t.mc > 0 ? t.vol24h / t.mc * 100 : 0;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 299, backdropFilter: "blur(3px)" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, background: C.bg1, borderLeft: `1px solid ${C.border}`, zIndex: 300, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                {t.imgUrl && <img src={t.imgUrl} alt="" style={{ width: 22, height: 22, borderRadius: 5 }} onError={e => e.target.style.display = "none"} />}
                <span style={{ fontSize: 18, fontWeight: 700, color: C.white, fontFamily: C.fontSans }}>{t.name}</span>
                <ChainPill chain={t.chain} />
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: C.fontMono }}>{t.fullName}</div>
              <div style={{ fontSize: 9, color: C.textGhost, fontFamily: C.fontMono, marginTop: 3, wordBreak: "break-all" }}>{t.address}</div>
            </div>
            <button onClick={onClose} style={{ background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 4, color: C.textSoft, cursor: "pointer", padding: "4px 10px", fontSize: 10, fontFamily: C.fontMono }}>✕</button>
          </div>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 22, flex: 1 }}>
          <div><SH>Key Metrics</SH><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}><Stat label="Market Cap" value={fmt(t.mc)} /><Stat label="Liquidity" value={fmt(t.liq)} warn={t.liq < 10000} /><Stat label="Price" value={`$${t.price < 0.001 ? t.price.toExponential(2) : t.price.toFixed(6)}`} /><Stat label="FDV" value={fmt(t.fdv)} /><Stat label="Liq/MC" value={`${lmr.toFixed(1)}%`} warn={lmr < 5} danger={lmr < 2} accent={lmr > 15} /><Stat label="Vol/MC" value={`${vmr.toFixed(0)}%`} accent={vmr > 100} /></div></div>
          <div><SH>Price Action</SH><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}><Stat label="5m" value={<Delta val={t.pc5m} sz={13} />} /><Stat label="1h" value={<Delta val={t.pc1h} sz={13} />} /><Stat label="6h" value={<Delta val={t.pc6h} sz={13} />} /><Stat label="24h" value={<Delta val={t.pc24h} sz={13} />} /></div></div>
          <div><SH>Volume</SH><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}><Stat label="5m" value={fmt(t.vol5m)} /><Stat label="1h" value={fmt(t.vol1h)} /><Stat label="6h" value={fmt(t.vol6h)} /><Stat label="24h" value={fmt(t.vol24h)} /></div></div>
          <div>
            <SH>Order Flow</SH>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[["5 MIN", t.buys5m, t.sells5m, t.buyPct5m], ["1 HOUR", t.buys1h, t.sells1h, t.buyPct1h]].map(([lbl, b, s, bp]) => (
                <div key={lbl}>
                  <div style={{ fontSize: 9, color: C.textMuted, fontFamily: C.fontMono, letterSpacing: 0.8, marginBottom: 6 }}>{lbl}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: C.accent, fontFamily: C.fontMono, fontWeight: 600 }}>{b} buys</span>
                    <span style={{ fontSize: 11, color: C.red, fontFamily: C.fontMono, fontWeight: 600 }}>{s} sells</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: C.redBg, overflow: "hidden" }}>
                    <div style={{ width: `${bp}%`, height: "100%", background: C.accent, opacity: 0.65, borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div><SH>Info</SH><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><Stat label="Age" value={fmtAge(t.age)} /><Stat label="DEX" value={t.dex.toUpperCase()} /><Stat label="24h Txns" value={t.txns24h.toLocaleString()} /><Stat label="Boosts" value={t.boosts || 0} accent={t.boosts > 0} /><Stat label="Quote" value={t.quoteSymbol} /></div></div>
          {(t.websites.length > 0 || t.socials.length > 0) && (
            <div><SH>Links</SH><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{t.websites.map((w, i) => <span key={`w${i}`} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: C.bg3, border: `1px solid ${C.border}`, color: C.blue, fontFamily: C.fontMono }}>{w.label || "Website"}</span>)}{t.socials.map((s, i) => <span key={`s${i}`} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: C.bg3, border: `1px solid ${C.border}`, color: C.purple, fontFamily: C.fontMono }}>{s.type || "Social"}</span>)}</div></div>
          )}
          <div style={{ marginTop: "auto", paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
            {[{ l: "DEXSCREENER", u: `https://dexscreener.com/${t.chain}/${t.pairAddress}` }, { l: "AXIOM", u: `https://axiom.trade/t/${t.address}/` }, { l: "JUPITER", u: `https://jup.ag/swap/SOL-${t.address}` }].map(lk => (
              <a key={lk.l} href={lk.u} target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: "10px 0", textAlign: "center", textDecoration: "none", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 4, color: C.textSoft, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, fontFamily: C.fontMono, transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent + "50"; e.currentTarget.style.color = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSoft; }}
              >{lk.l}</a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

/* ═══ MAIN ═══ */
export default function SignalTerminal() {
  const [pairs, setPairs] = useState([]);
  const [boosted, setBoosted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [chain, setChain] = useState("solana");
  const [sortKey, setSortKey] = useState("vol5m");
  const [sortDir, setSortDir] = useState(-1);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [searchRes, setSearchRes] = useState(null);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState("new");
  const [lastUp, setLastUp] = useState(null);
  const stRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [pd, bd] = await Promise.all([fetchNewPairs(chain), fetchBoosted()]);
      setPairs(pd.map(norm).filter(p => p.mc > 0 || p.liq > 0));
      setBoosted(bd); setLastUp(new Date());
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [chain]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [load]);

  useEffect(() => {
    if (!search.trim()) { setSearchRes(null); return; }
    clearTimeout(stRef.current);
    stRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchRes((await searchTokens(search)).map(norm));
      setSearching(false);
    }, 500);
    return () => clearTimeout(stRef.current);
  }, [search]);

  const data = useMemo(() => {
    if (searchRes) return searchRes;
    let d = [...pairs];
    if (tab === "gainers") d = d.filter(p => p.pc5m > 0).sort((a, b) => b.pc5m - a.pc5m);
    else if (tab === "volume") d.sort((a, b) => b.vol24h - a.vol24h);
    else d.sort((a, b) => ((b[sortKey] ?? 0) - (a[sortKey] ?? 0)) * sortDir);
    return d;
  }, [pairs, searchRes, tab, sortKey, sortDir]);

  const boostSet = useMemo(() => new Set(boosted.map(b => b.tokenAddress)), [boosted]);

  const doSort = (k) => { if (sortKey === k) setSortDir(d => d * -1); else { setSortKey(k); setSortDir(-1); } };

  const TH = ({ k, children, w }) => (
    <th onClick={() => doSort(k)} style={{ padding: "10px 8px", textAlign: "right", fontSize: 9, fontWeight: 600, letterSpacing: 1, color: sortKey === k ? C.accent : C.textMuted, fontFamily: C.fontMono, cursor: "pointer", textTransform: "uppercase", whiteSpace: "nowrap", width: w, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.bg2, zIndex: 2, userSelect: "none" }}>
      {children}{sortKey === k && <span style={{ opacity: 0.4, marginLeft: 3 }}>{sortDir === -1 ? "↓" : "↑"}</span>}
    </th>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg0, color: C.text, fontFamily: C.fontSans }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        @font-face{font-family:'Geist Mono';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-mono/GeistMono-Regular.woff2') format('woff2');font-weight:400}
        @font-face{font-family:'Geist Mono';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-mono/GeistMono-Medium.woff2') format('woff2');font-weight:500}
        @font-face{font-family:'Geist Mono';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-mono/GeistMono-SemiBold.woff2') format('woff2');font-weight:600}
        @font-face{font-family:'Geist Mono';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-mono/GeistMono-Bold.woff2') format('woff2');font-weight:700}
        @font-face{font-family:'Geist';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-sans/Geist-Regular.woff2') format('woff2');font-weight:400}
        @font-face{font-family:'Geist';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-sans/Geist-Medium.woff2') format('woff2');font-weight:500}
        @font-face{font-family:'Geist';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-sans/Geist-SemiBold.woff2') format('woff2');font-weight:600}
        @font-face{font-family:'Geist';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-sans/Geist-Bold.woff2') format('woff2');font-weight:700}
        *{box-sizing:border-box;margin:0;padding:0}body{background:${C.bg0}}
        *::-webkit-scrollbar{width:3px;height:3px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
        @keyframes fadeUp{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        table{border-collapse:collapse;width:100%}th,td{text-align:right}th:first-child,td:first-child{text-align:left}
      `}</style>

      {/* Grain */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.015, backgroundImage: `radial-gradient(circle at 1px 1px, ${C.textMuted} 1px, transparent 0)`, backgroundSize: "24px 24px" }} />

      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: `1px solid ${C.border}`, background: C.bg1, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 4, height: 18, borderRadius: 1, background: C.accent }} />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 3.5, color: C.white, fontFamily: C.fontMono }}>SIGNAL</span>
          </div>
          <span style={{ width: 1, height: 14, background: C.border }} />
          <div style={{ position: "relative" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search token or address..."
              style={{ width: 260, padding: "7px 12px 7px 28px", borderRadius: 4, background: C.bg2, border: `1px solid ${C.border}`, color: C.text, fontSize: 11, fontFamily: C.fontMono, outline: "none" }}
              onFocus={e => e.target.style.borderColor = C.accent + "40"} onBlur={e => e.target.style.borderColor = C.border} />
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: C.textMuted }}>⌕</span>
            {searching && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: C.accent, fontFamily: C.fontMono, animation: "pulse 1s infinite" }}>···</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {lastUp && <span style={{ fontSize: 9, color: C.textMuted, fontFamily: C.fontMono }}>{lastUp.toLocaleTimeString("en-US", { hour12: false })}</span>}
          <button onClick={load} disabled={loading} style={{ padding: "5px 14px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg2, color: loading ? C.textMuted : C.textSoft, cursor: loading ? "default" : "pointer", fontSize: 9, fontWeight: 600, letterSpacing: 1, fontFamily: C.fontMono }}
            onMouseEnter={e => { if (!loading) { e.currentTarget.style.borderColor = C.accent + "40"; e.currentTarget.style.color = C.accent; } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = loading ? C.textMuted : C.textSoft; }}
          >{loading ? "···" : "REFRESH"}</button>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: err ? C.red : C.accent, animation: "pulse 2.5s ease-in-out infinite" }} />
            <span style={{ fontSize: 9, color: err ? C.red : C.accent, fontFamily: C.fontMono, fontWeight: 500 }}>{err ? "ERR" : "LIVE"}</span>
          </div>
        </div>
      </header>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 24px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", gap: 2, background: C.bg2, borderRadius: 4, padding: 2, border: `1px solid ${C.border}` }}>
          {Object.entries(CHAINS).map(([k, v]) => (
            <button key={k} onClick={() => { setChain(k); setSearch(""); setSearchRes(null); }} style={{ padding: "5px 12px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 600, letterSpacing: 0.8, fontFamily: C.fontMono, background: chain === k ? C.accentBg : "transparent", color: chain === k ? C.accent : C.textMuted }}>{v.label}</button>
          ))}
        </div>
        <span style={{ width: 1, height: 14, background: C.border }} />
        <div style={{ display: "flex", gap: 2 }}>
          {[["new", "NEW PAIRS"], ["gainers", "5m GAINERS"], ["volume", "VOLUME"]].map(([id, l]) => (
            <button key={id} onClick={() => { setTab(id); setSearch(""); setSearchRes(null); }} style={{ padding: "5px 12px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 600, letterSpacing: 1, fontFamily: C.fontMono, background: tab === id ? C.surface : "transparent", color: tab === id ? C.white : C.textMuted }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: C.fontMono }}>{data.length} pairs</span>
      </div>

      {/* Table */}
      <div style={{ padding: "0 24px 80px" }}>
        {loading && !pairs.length ? (
          <div style={{ padding: 60, textAlign: "center", color: C.textMuted, fontSize: 11, fontFamily: C.fontMono, animation: "pulse 1.5s infinite" }}>Loading data...</div>
        ) : err && !pairs.length ? (
          <div style={{ padding: 60, textAlign: "center", color: C.red, fontSize: 11, fontFamily: C.fontMono }}>Failed: {err}<br /><br /><button onClick={load} style={{ padding: "8px 20px", background: C.redBg, border: `1px solid ${C.red}30`, borderRadius: 4, color: C.red, cursor: "pointer", fontFamily: C.fontMono, fontSize: 10 }}>RETRY</button></div>
        ) : (
          <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 6px 6px" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ padding: "10px 8px 10px 14px", textAlign: "left", fontSize: 9, fontWeight: 600, letterSpacing: 1, color: C.textMuted, fontFamily: C.fontMono, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.bg2, zIndex: 2, minWidth: 180 }}>TOKEN</th>
                  <TH k="mc" w={80}>MC</TH>
                  <TH k="liq" w={72}>LIQ</TH>
                  <TH k="vol5m" w={68}>VOL 5m</TH>
                  <TH k="vol1h" w={68}>VOL 1h</TH>
                  <TH k="vol24h" w={72}>VOL 24h</TH>
                  <TH k="pc5m" w={62}>Δ5m</TH>
                  <TH k="pc1h" w={62}>Δ1h</TH>
                  <TH k="pc24h" w={62}>Δ24h</TH>
                  <th style={{ padding: "10px 8px", textAlign: "right", fontSize: 9, fontWeight: 600, letterSpacing: 1, color: C.textMuted, fontFamily: C.fontMono, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.bg2, zIndex: 2, width: 70 }}>B/S 5m</th>
                  <TH k="txns24h" w={64}>TXN</TH>
                  <th style={{ padding: "10px 8px", fontSize: 9, fontWeight: 600, letterSpacing: 1, color: C.textMuted, fontFamily: C.fontMono, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.bg2, zIndex: 2, width: 48 }}>AGE</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t, i) => (
                  <tr key={t.id + i} onClick={() => setSelected(t)} style={{ cursor: "pointer", transition: "background 0.1s", background: i % 2 === 0 ? "transparent" : C.bg2 + "30", animation: `fadeUp 0.12s ease ${Math.min(i * 0.015, 0.3)}s both` }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.bg2 + "30"}>
                    <td style={{ padding: "9px 8px 9px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {t.imgUrl && <img src={t.imgUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0 }} onError={e => e.target.style.display = "none"} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: C.white, fontFamily: C.fontSans }}>{t.name}</span>
                            <ChainPill chain={t.chain} />
                            {boostSet.has(t.address) && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: C.accentBg, color: C.accent, fontFamily: C.fontMono, fontWeight: 700, border: `1px solid ${C.accent}20` }}>BOOST</span>}
                          </div>
                          <div style={{ fontSize: 9, color: C.textGhost, fontFamily: C.fontMono, marginTop: 1 }}>{t.address.slice(0, 6)}…{t.address.slice(-4)}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "9px 8px", fontSize: 11, fontWeight: 600, color: C.text, fontFamily: C.fontMono }}>{fmt(t.mc)}</td>
                    <td style={{ padding: "9px 8px", fontSize: 11, fontWeight: 500, color: t.liq < 10000 ? C.red : C.textSoft, fontFamily: C.fontMono }}>{fmt(t.liq)}</td>
                    <td style={{ padding: "9px 8px", fontSize: 11, fontWeight: 500, color: t.vol5m > 0 ? C.text : C.textMuted, fontFamily: C.fontMono }}>{fmt(t.vol5m)}</td>
                    <td style={{ padding: "9px 8px", fontSize: 11, fontWeight: 500, color: t.vol1h > 0 ? C.text : C.textMuted, fontFamily: C.fontMono }}>{fmt(t.vol1h)}</td>
                    <td style={{ padding: "9px 8px", fontSize: 11, fontWeight: 500, color: C.text, fontFamily: C.fontMono }}>{fmt(t.vol24h)}</td>
                    <td style={{ padding: "9px 8px" }}><Delta val={t.pc5m} /></td>
                    <td style={{ padding: "9px 8px" }}><Delta val={t.pc1h} /></td>
                    <td style={{ padding: "9px 8px" }}><Delta val={t.pc24h} /></td>
                    <td style={{ padding: "9px 8px" }}><BSBar pct={t.buyPct5m} /></td>
                    <td style={{ padding: "9px 8px", fontSize: 11, fontWeight: 500, color: C.textSoft, fontFamily: C.fontMono }}>{t.txns24h > 0 ? t.txns24h.toLocaleString() : "—"}</td>
                    <td style={{ padding: "9px 8px", fontSize: 10, color: C.textMuted, fontFamily: C.fontMono }}>{fmtAge(t.age)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.length && !loading && <div style={{ padding: 48, textAlign: "center", color: C.textMuted, fontSize: 11, fontFamily: C.fontMono }}>{search ? "No results" : "No pairs"}</div>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "8px 24px", borderTop: `1px solid ${C.border}`, background: C.bg1, display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 50 }}>
        <div style={{ display: "flex", gap: 16 }}>
          {[["DEXSCREENER", "https://dexscreener.com"], ["AXIOM", "https://axiom.trade"], ["JUPITER", "https://jup.ag"]].map(([l, u]) => (
            <a key={l} href={u} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1.5, color: C.textMuted, fontFamily: C.fontMono, textDecoration: "none" }}
              onMouseEnter={e => e.currentTarget.style.color = C.accent} onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>{l}</a>
          ))}
        </div>
        <div style={{ fontSize: 9, color: C.textGhost, fontFamily: C.fontMono, display: "flex", alignItems: "center", gap: 8 }}>
          DEXSCREENER API
          <span style={{ width: 4, height: 4, borderRadius: "50%", background: C.accent, animation: "pulse 2s infinite" }} />
        </div>
      </div>

      <Detail token={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
