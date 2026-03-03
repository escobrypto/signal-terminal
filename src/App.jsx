import { useState, useEffect, useMemo, useCallback } from "react";

const HELIUS_KEY = "efb053d6-f7c7-4c90-9bc5-0ce3af9c59df";
const BIRDEYE_KEY = "94ba9de0953642878038f5a7eccc1114";
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const HELIUS_API = "https://api.helius.xyz/v0";
const BIRDEYE = "https://public-api.birdeye.so";
const birdH = { accept:"application/json", "x-chain":"solana", "X-API-KEY":BIRDEYE_KEY };

const T={bg:"#060709",bg1:"#0a0b0f",bg2:"#0e0f14",bg3:"#13141b",s:"#1a1b24",sH:"#1f2030",brd:"#1a1b28",tx:"#c8cce0",txS:"#7d82a0",txM:"#484c68",txG:"#2e3148",g:"#10b981",gBg:"#10b98108",gBrd:"#10b98118",r:"#ef4444",rBg:"#ef444408",a:"#f59e0b",b:"#3b82f6",p:"#8b5cf6",w:"#eaecff",mono:"'Geist Mono','JetBrains Mono',monospace",sans:"'Geist','DM Sans',-apple-system,sans-serif"};

const short=(a,n=4)=>a?`${a.slice(0,n)}...${a.slice(-n)}`:"—";
const fmt=(n)=>{if(!n&&n!==0)return"—";if(n>=1e9)return`$${(n/1e9).toFixed(1)}B`;if(n>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(n>=1e3)return`$${(n/1e3).toFixed(1)}K`;return`$${n.toFixed(0)}`};
const fmtAge=(ts)=>{if(!ts)return"—";const s=Math.floor((Date.now()-ts)/1000);if(s<60)return`${s}s`;const m=Math.floor(s/60);if(m<60)return`${m}m`;const h=Math.floor(m/60);if(h<24)return`${h}h`;return`${Math.floor(h/24)}d`};
const cp=(t)=>navigator.clipboard.writeText(t);

/* ═══ API ═══ */
async function heliusSwaps(addr,limit=20){try{const r=await fetch(`${HELIUS_API}/addresses/${addr}/transactions?api-key=${HELIUS_KEY}&limit=${limit}&type=SWAP`);return r.ok?await r.json():[]}catch{return[]}}
async function heliusAllTxns(addr,limit=15){try{const r=await fetch(`${HELIUS_API}/addresses/${addr}/transactions?api-key=${HELIUS_KEY}&limit=${limit}`);return r.ok?await r.json():[]}catch{return[]}}
async function birdPortfolio(w){try{const r=await fetch(`${BIRDEYE}/v1/wallet/token_list?wallet=${w}`,{headers:birdH});const d=await r.json();return d.data?.items||[]}catch{return[]}}
async function birdOverview(addr){try{const r=await fetch(`${BIRDEYE}/defi/token_overview?address=${addr}`,{headers:birdH});const d=await r.json();return d.data||null}catch{return null}}

function parseSwaps(txns){
  const out=[];
  for(const tx of txns){
    if(tx.type!=="SWAP")continue;
    const time=tx.timestamp?tx.timestamp*1000:Date.now();
    const sig=tx.signature||"";
    const src=tx.source||"";
    let action="SWAP",mint="",solAmt=0;
    const tOut=tx.events?.swap?.tokenOutputs?.[0];
    const tIn=tx.events?.swap?.tokenInputs?.[0];
    const nIn=tx.events?.swap?.nativeInput;
    const nOut=tx.events?.swap?.nativeOutput;
    if(tOut?.mint&&tOut.mint!=="So11111111111111111111111111111111"){action="BUY";mint=tOut.mint}
    else if(tIn?.mint&&tIn.mint!=="So11111111111111111111111111111111"){action="SELL";mint=tIn.mint}
    if(nIn?.amount)solAmt=nIn.amount/1e9;
    if(nOut?.amount&&action==="SELL")solAmt=nOut.amount/1e9;
    if(mint)out.push({action,mint,solAmt,time,sig,src,desc:tx.description||""});
  }
  return out;
}

/* ═══ WALLET DB ═══ */
const INIT_WALLETS=[
  {addr:"AC2RiUxrJFe1AJMcSz2QLwGGJESTit67JFoc7YB4rBbq",tag:"WHALE-A",notes:"Consistent 5-10x, early narratives",tier:1},
  {addr:"FnMtJFpGYoAQTJPJnwDHFQnxTPJdbnEMfJM1PwfaKVmt",tag:"DEGEN-1",notes:"High frequency, catches pumps",tier:1},
  {addr:"5GmLJQiYuCMNnEv4PoVWkfz1hUG3oTPzA6sDFwusLiVJ",tag:"SNIPER-1",notes:"Snipes launches, fast exits",tier:1},
  {addr:"HNoEt8Jd2gPRaN66HXnCGEHZMwqk4RcaLEJ8UiYq4JbV",tag:"WHALE-B",notes:"Big size, holds longer",tier:2},
  {addr:"Cz1kHi3eFKZSHFMk6sbcbVhDfPLtojPgmrv72KFSkbRN",tag:"SMART-1",notes:"Good risk mgmt",tier:2},
  {addr:"8rvz2Bg4DP32KxyTr2N1REXFBEQwBqPaACrCEZNyN4Lq",tag:"ALPHA-1",notes:"Finds tokens before CT",tier:2},
  {addr:"GmEFwJRTicRNJbiFqxPBEFVFnMYTwWaKon7oNPHZcaeh",tag:"FLIPPER",notes:"Quick flips, high WR",tier:2},
];

/* ═══ UI ATOMS ═══ */
const Badge=({children,color=T.g})=><span style={{fontSize:8,padding:"2px 6px",borderRadius:2,background:`${color}0d`,color,fontFamily:T.mono,fontWeight:700,letterSpacing:.5,border:`1px solid ${color}15`}}>{children}</span>;
const TierBadge=({tier})=><Badge color={tier===1?T.g:tier===2?T.b:T.txM}>{tier===1?"T1":tier===2?"T2":"T3"}</Badge>;
const ActionTag=({action})=><span style={{fontSize:10,fontWeight:800,color:action==="BUY"?T.g:action==="SELL"?T.r:T.txM,fontFamily:T.mono,letterSpacing:.5,minWidth:28,display:"inline-block"}}>{action}</span>;

const CopyBtn=({text,label="COPY"})=>{const[ok,setOk]=useState(false);return<button onClick={e=>{e.stopPropagation();cp(text);setOk(true);setTimeout(()=>setOk(false),1200)}} style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${ok?T.g+"30":T.brd}`,background:ok?T.gBg:"transparent",color:ok?T.g:T.txM,fontSize:8,fontWeight:700,fontFamily:T.mono,cursor:"pointer",letterSpacing:.5}}>{ok?"✓":label}</button>};
const AxiomBtn=({mint})=><a href={`https://axiom.trade/t/${mint}/`} target="_blank" rel="noopener noreferrer" style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${T.g}20`,background:T.gBg,color:T.g,fontSize:8,fontWeight:700,fontFamily:T.mono,textDecoration:"none",letterSpacing:.5}} onMouseEnter={e=>{e.currentTarget.style.background=T.g+"15"}} onMouseLeave={e=>{e.currentTarget.style.background=T.gBg}}>AXIOM ↗</a>;
const DexBtn=({addr})=><a href={`https://dexscreener.com/solana/${addr}`} target="_blank" rel="noopener noreferrer" style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${T.b}20`,background:`${T.b}08`,color:T.b,fontSize:8,fontWeight:700,fontFamily:T.mono,textDecoration:"none",letterSpacing:.5}}>DEX ↗</a>;

/* ═══ TOKEN INFO CACHE ═══ */
const tokenCache = {};
function useTokenInfo(mints) {
  const [info, setInfo] = useState({});
  useEffect(() => {
    const toFetch = mints.filter(m => m && !tokenCache[m] && !info[m]);
    if (!toFetch.length) return;
    let cancelled = false;
    (async () => {
      for (const mint of toFetch.slice(0, 12)) {
        if (cancelled) break;
        const data = await birdOverview(mint);
        if (data) {
          tokenCache[mint] = data;
          if (!cancelled) setInfo(p => ({ ...p, [mint]: data }));
        }
        await new Promise(r => setTimeout(r, 200)); // rate limit
      }
    })();
    return () => { cancelled = true; };
  }, [mints.join(",")]);
  return { ...tokenCache, ...info };
}

/* ═══ LIVE FEED ═══ */
const LiveFeed = ({ wallets }) => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("ALL");

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const all = [];
    // Parallel fetch all wallets
    const results = await Promise.allSettled(
      wallets.map(async w => {
        const txns = await heliusSwaps(w.addr, 15);
        return parseSwaps(txns).map(s => ({ ...s, wallet: w.tag, walletAddr: w.addr, tier: w.tier }));
      })
    );
    results.forEach(r => { if (r.status === "fulfilled") all.push(...r.value); });
    all.sort((a, b) => b.time - a.time);
    setTrades(all.slice(0, 80));
    setLoading(false);
  }, [wallets]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const mints = useMemo(() => [...new Set(trades.map(t => t.mint).filter(Boolean))], [trades]);
  const tInfo = useTokenInfo(mints);
  const filtered = filter === "ALL" ? trades : trades.filter(t => t.action === filter);

  // Convergence: multiple wallets buying same token
  const convergence = useMemo(() => {
    const map = {};
    trades.filter(t => t.action === "BUY" && t.mint).forEach(t => {
      if (!map[t.mint]) map[t.mint] = { wallets: new Set(), times: [] };
      map[t.mint].wallets.add(t.wallet);
      map[t.mint].times.push(t.time);
    });
    return Object.entries(map)
      .filter(([_, v]) => v.wallets.size >= 2)
      .map(([mint, v]) => ({ mint, count: v.wallets.size, names: [...v.wallets], lastTime: Math.max(...v.times) }))
      .sort((a, b) => b.count - a.count);
  }, [trades]);

  return (
    <div>
      {/* CONVERGENCE ALERT */}
      {convergence.length > 0 && (
        <div style={{ marginBottom:20, padding:"16px 18px", borderRadius:8, background:T.gBg, border:`1px solid ${T.gBrd}` }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:2.5, color:T.g, fontFamily:T.mono, marginBottom:12 }}>⚡ CONVERGENCE — MULTIPLE WALLETS BUYING SAME TOKEN</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {convergence.map((c, i) => {
              const info = tInfo[c.mint];
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderRadius:6, background:T.bg2, border:`1px solid ${T.g}12` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <span style={{ fontSize:15, fontWeight:700, color:T.w, fontFamily:T.sans }}>{info?.symbol ? `$${info.symbol}` : short(c.mint, 6)}</span>
                    <Badge color={T.g}>{c.count} WALLETS</Badge>
                    <span style={{ fontSize:9, color:T.txS, fontFamily:T.mono }}>{c.names.join(" · ")}</span>
                    {info?.mc && <span style={{ fontSize:10, color:T.txM, fontFamily:T.mono }}>MC {fmt(info.mc)}</span>}
                    {info?.liquidity && <span style={{ fontSize:10, color:T.txM, fontFamily:T.mono }}>LIQ {fmt(info.liquidity)}</span>}
                  </div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span style={{ fontSize:9, color:T.txM, fontFamily:T.mono }}>{fmtAge(c.lastTime)}</span>
                    <CopyBtn text={c.mint} label="CA" />
                    <AxiomBtn mint={c.mint} />
                    <DexBtn addr={c.mint} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CONTROLS */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
        <div style={{ display:"flex", gap:2, background:T.bg2, borderRadius:4, padding:2, border:`1px solid ${T.brd}` }}>
          {["ALL","BUY","SELL"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding:"5px 14px", borderRadius:3, border:"none", cursor:"pointer", fontSize:9, fontWeight:600, letterSpacing:.8, fontFamily:T.mono, background:filter===f?(f==="BUY"?T.gBg:f==="SELL"?T.rBg:T.s):"transparent", color:filter===f?(f==="BUY"?T.g:f==="SELL"?T.r:T.w):T.txM }}>{f}</button>
          ))}
        </div>
        <button onClick={loadFeed} disabled={loading} style={{ padding:"5px 16px", borderRadius:4, border:`1px solid ${T.brd}`, background:"transparent", color:loading?T.txM:T.txS, fontSize:9, fontWeight:600, fontFamily:T.mono, cursor:loading?"default":"pointer", letterSpacing:1 }}>{loading ? "SCANNING..." : "REFRESH"}</button>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:9, color:T.txM, fontFamily:T.mono }}>{filtered.length} trades from {wallets.length} wallets</span>
      </div>

      {/* TRADE FEED */}
      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
        {filtered.map((t, i) => {
          const info = tInfo[t.mint];
          return (
            <div key={t.sig+i} style={{ display:"grid", gridTemplateColumns:"34px 72px 1fr 90px 120px", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:4, background:i%2===0?"transparent":T.bg2+"40", border:`1px solid ${t.action==="BUY"&&convergence.some(c=>c.mint===t.mint)?T.g+"15":"transparent"}` }}
              onMouseEnter={e => e.currentTarget.style.background=T.sH}
              onMouseLeave={e => e.currentTarget.style.background=i%2===0?"transparent":T.bg2+"40"}>
              <ActionTag action={t.action} />
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:10, fontWeight:700, color:T.g, fontFamily:T.mono }}>{t.wallet}</span>
                <TierBadge tier={t.tier} />
              </div>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:T.w, fontFamily:T.sans }}>{info?.symbol ? `$${info.symbol}` : short(t.mint, 5)}</span>
                  {info?.mc && <span style={{ fontSize:9, color:T.txM, fontFamily:T.mono }}>MC {fmt(info.mc)}</span>}
                  {t.solAmt > 0 && <span style={{ fontSize:9, color:t.action==="BUY"?T.g:T.r, fontFamily:T.mono, fontWeight:600 }}>{t.solAmt.toFixed(2)} SOL</span>}
                </div>
                <span style={{ fontSize:9, color:T.txG, fontFamily:T.mono }}>{t.src} · {fmtAge(t.time)}</span>
              </div>
              <span style={{ fontSize:9, color:T.txG, fontFamily:T.mono, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textAlign:"right" }}>{short(t.mint)}</span>
              <div style={{ display:"flex", gap:4, justifyContent:"flex-end" }}>
                <CopyBtn text={t.mint} label="CA" />
                <AxiomBtn mint={t.mint} />
                <DexBtn addr={t.mint} />
              </div>
            </div>
          );
        })}
      </div>
      {loading && !trades.length && <div style={{ padding:48, textAlign:"center", color:T.txM, fontSize:11, fontFamily:T.mono }}>Scanning {wallets.length} wallets for recent swaps...</div>}
      {!loading && !trades.length && <div style={{ padding:48, textAlign:"center", color:T.txM, fontSize:11, fontFamily:T.mono }}>No swaps found. Hit REFRESH to try again.</div>}
    </div>
  );
};

/* ═══ WALLET MANAGER ═══ */
const WalletManager = ({ wallets, setWallets }) => {
  const [input, setInput] = useState("");
  const [tag, setTag] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [stats, setStats] = useState({});
  const [busy, setBusy] = useState(null);

  const add = () => {
    if (!input.trim() || input.length < 32) return;
    setWallets(p => [...p, { addr: input.trim(), tag: tag || `W-${p.length+1}`, notes: "", tier: 3 }]);
    setInput(""); setTag("");
  };
  const remove = (addr) => setWallets(p => p.filter(w => w.addr !== addr));

  const analyze = async (addr) => {
    if (expanded === addr && stats[addr]) { setExpanded(null); return; }
    setExpanded(addr);
    if (stats[addr]) return;
    setBusy(addr);
    const [portfolio, txns] = await Promise.allSettled([birdPortfolio(addr), heliusSwaps(addr, 25)]);
    const port = portfolio.status === "fulfilled" ? portfolio.value : [];
    const swaps = txns.status === "fulfilled" ? parseSwaps(txns.value) : [];
    const holdings = port.filter(t => t.uiAmount > 0 && t.symbol !== "SOL").sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
    const totalVal = holdings.reduce((s, t) => s + (t.valueUsd || 0), 0);
    const solBal = port.find(t => t.symbol === "SOL");
    const buys = swaps.filter(s => s.action === "BUY").length;
    const sells = swaps.filter(s => s.action === "SELL").length;
    setStats(p => ({ ...p, [addr]: { holdings: holdings.slice(0, 15), totalVal, sol: solBal?.uiAmount || 0, buys, sells, swaps: swaps.slice(0, 20) } }));
    setBusy(null);
  };

  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Paste wallet address..." style={{ flex:1, padding:"8px 12px", borderRadius:4, background:T.bg2, border:`1px solid ${T.brd}`, color:T.tx, fontSize:11, fontFamily:T.mono, outline:"none" }} onKeyDown={e => e.key === "Enter" && add()} onFocus={e => e.target.style.borderColor = T.g + "40"} onBlur={e => e.target.style.borderColor = T.brd} />
        <input value={tag} onChange={e => setTag(e.target.value)} placeholder="Tag" style={{ width:80, padding:"8px", borderRadius:4, background:T.bg2, border:`1px solid ${T.brd}`, color:T.tx, fontSize:11, fontFamily:T.mono, outline:"none" }} />
        <button onClick={add} style={{ padding:"8px 18px", borderRadius:4, background:T.gBg, border:`1px solid ${T.gBrd}`, color:T.g, fontSize:9, fontWeight:700, letterSpacing:1, fontFamily:T.mono, cursor:"pointer" }}>+ ADD</button>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {wallets.map((w) => {
          const st = stats[w.addr];
          const isExp = expanded === w.addr;
          return (
            <div key={w.addr} style={{ borderRadius:6, border:`1px solid ${isExp ? T.g + "18" : T.brd}`, overflow:"hidden" }}>
              {/* Row */}
              <div onClick={() => analyze(w.addr)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 14px", cursor:"pointer", background:isExp ? T.gBg : "transparent", transition:"background .15s" }}
                onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = T.sH }}
                onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = "transparent" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:T.g, fontFamily:T.mono, minWidth:70 }}>{w.tag}</span>
                  <TierBadge tier={w.tier} />
                  <span style={{ fontSize:10, color:T.txM, fontFamily:T.mono, cursor:"pointer" }} onClick={e => { e.stopPropagation(); cp(w.addr) }}>{short(w.addr)}</span>
                  <span style={{ fontSize:9, color:T.txG, fontFamily:T.mono }}>{w.notes}</span>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  {st && <span style={{ fontSize:9, color:T.txS, fontFamily:T.mono }}>{st.sol.toFixed(1)} SOL · {fmt(st.totalVal)} · {st.buys}B/{st.sells}S</span>}
                  {busy === w.addr && <span style={{ fontSize:9, color:T.b, fontFamily:T.mono }}>analyzing...</span>}
                  <a href={`https://solscan.io/account/${w.addr}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ padding:"4px 8px", borderRadius:3, border:`1px solid ${T.brd}`, color:T.txM, fontSize:8, fontWeight:700, fontFamily:T.mono, textDecoration:"none" }}>SOLSCAN</a>
                  {w.tier === 3 && <button onClick={e => { e.stopPropagation(); remove(w.addr) }} style={{ padding:"4px 8px", borderRadius:3, border:`1px solid ${T.r}15`, background:"transparent", color:T.r, fontSize:8, fontWeight:700, fontFamily:T.mono, cursor:"pointer" }}>✕</button>}
                </div>
              </div>

              {/* Expanded Detail */}
              {isExp && st && (
                <div style={{ padding:"14px 14px 18px", borderTop:`1px solid ${T.brd}` }}>
                  <div style={{ fontSize:9, color:T.g, fontFamily:T.mono, letterSpacing:2, fontWeight:700, marginBottom:10 }}>HOLDINGS</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:18 }}>
                    {st.holdings.length === 0 && <span style={{ fontSize:10, color:T.txM, fontFamily:T.mono }}>No token holdings found</span>}
                    {st.holdings.map((tk, j) => (
                      <div key={j} style={{ display:"grid", gridTemplateColumns:"80px 1fr 70px 60px 90px", alignItems:"center", gap:6, padding:"5px 8px", borderRadius:3, background:j % 2 === 0 ? "transparent" : T.bg2 + "30", fontSize:10, fontFamily:T.mono }}>
                        <span style={{ color:T.b, fontWeight:600 }}>{tk.symbol || "???"}</span>
                        <span style={{ color:T.txG, cursor:"pointer" }} onClick={() => cp(tk.address)}>{short(tk.address)}</span>
                        <span style={{ color:T.txS, textAlign:"right" }}>{tk.uiAmount > 1e6 ? `${(tk.uiAmount / 1e6).toFixed(1)}M` : tk.uiAmount > 1e3 ? `${(tk.uiAmount / 1e3).toFixed(1)}K` : tk.uiAmount.toFixed(1)}</span>
                        <span style={{ color:tk.valueUsd > 100 ? T.g : T.txM, textAlign:"right", fontWeight:600 }}>{tk.valueUsd > 0 ? fmt(tk.valueUsd) : "—"}</span>
                        <div style={{ display:"flex", gap:3, justifyContent:"flex-end" }}>
                          <CopyBtn text={tk.address} label="CA" />
                          <AxiomBtn mint={tk.address} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize:9, color:T.p, fontFamily:T.mono, letterSpacing:2, fontWeight:700, marginBottom:10 }}>RECENT SWAPS</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    {st.swaps.length === 0 && <span style={{ fontSize:10, color:T.txM, fontFamily:T.mono }}>No recent swaps</span>}
                    {st.swaps.map((sw, j) => (
                      <div key={j} style={{ display:"grid", gridTemplateColumns:"34px 100px 80px 1fr 60px 70px", alignItems:"center", gap:6, padding:"4px 8px", borderRadius:3, background:j % 2 === 0 ? "transparent" : T.bg2 + "20", fontSize:10, fontFamily:T.mono }}>
                        <ActionTag action={sw.action} />
                        <span style={{ color:T.txS, cursor:"pointer" }} onClick={() => cp(sw.mint)}>{short(sw.mint)}</span>
                        {sw.solAmt > 0 ? <span style={{ color:sw.action === "BUY" ? T.g : T.r }}>{sw.solAmt.toFixed(2)} SOL</span> : <span style={{ color:T.txG }}>—</span>}
                        <span style={{ color:T.txG }}>{sw.src}</span>
                        <span style={{ color:T.txM, textAlign:"right" }}>{fmtAge(sw.time)}</span>
                        <div style={{ display:"flex", gap:3, justifyContent:"flex-end" }}>
                          <CopyBtn text={sw.mint} label="CA" />
                          <AxiomBtn mint={sw.mint} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ═══ MAIN ═══ */
export default function App() {
  const [tab, setTab] = useState("feed");
  const [wallets, setWallets] = useState(INIT_WALLETS);

  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.tx, fontFamily:T.sans }}>
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
        *{box-sizing:border-box;margin:0;padding:0}body{background:${T.bg}}
        *::-webkit-scrollbar{width:3px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:${T.brd};border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
      `}</style>

      <div style={{ position:"fixed", inset:0, pointerEvents:"none", opacity:.01, backgroundImage:`radial-gradient(circle at 1px 1px, ${T.txM} 1px, transparent 0)`, backgroundSize:"24px 24px" }} />

      <header style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 24px", borderBottom:`1px solid ${T.brd}`, background:T.bg1, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:4, height:22, borderRadius:1, background:T.g }} />
          <div>
            <div style={{ fontSize:15, fontWeight:700, letterSpacing:4, color:T.w, fontFamily:T.mono }}>SIGNAL</div>
            <div style={{ fontSize:8, color:T.txM, fontFamily:T.mono, letterSpacing:2.5, marginTop:1 }}>WALLET INTELLIGENCE</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <Badge color={T.g}>HELIUS</Badge>
          <Badge color={T.p}>BIRDEYE</Badge>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginLeft:6 }}>
            <span style={{ width:5, height:5, borderRadius:"50%", background:T.g, animation:"pulse 2.5s ease-in-out infinite" }} />
            <span style={{ fontSize:9, color:T.g, fontFamily:T.mono, fontWeight:500 }}>LIVE</span>
          </div>
        </div>
      </header>

      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 24px", borderBottom:`1px solid ${T.brd}` }}>
        {[["feed", "LIVE FEED", "What are they buying NOW"], ["wallets", "MY WALLETS", "Analyze & manage"]].map(([id, l, desc]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding:"8px 22px", borderRadius:5, border:`1px solid ${tab === id ? T.g + "20" : T.brd}`, cursor:"pointer", fontSize:10, fontWeight:600, letterSpacing:1.2, fontFamily:T.mono, background:tab === id ? T.gBg : "transparent", color:tab === id ? T.g : T.txM, transition:"all .15s" }}>
            {l}<div style={{ fontSize:8, color:tab === id ? T.g + "80" : T.txG, fontWeight:400, marginTop:2, letterSpacing:.5 }}>{desc}</div>
          </button>
        ))}
        <div style={{ flex:1 }} />
        <span style={{ fontSize:9, color:T.txM, fontFamily:T.mono }}>{wallets.length} wallets</span>
      </div>

      <div style={{ padding:"18px 24px 80px" }}>
        {tab === "feed" && <LiveFeed wallets={wallets} />}
        {tab === "wallets" && <WalletManager wallets={wallets} setWallets={setWallets} />}
      </div>

      <div style={{ position:"fixed", bottom:0, left:0, right:0, padding:"8px 24px", borderTop:`1px solid ${T.brd}`, background:T.bg1, display:"flex", justifyContent:"space-between", alignItems:"center", zIndex:50 }}>
        <div style={{ display:"flex", gap:16 }}>
          {[["AXIOM", "https://axiom.trade"], ["JUPITER", "https://jup.ag"], ["DEXSCREENER", "https://dexscreener.com"]].map(([l, u]) => (
            <a key={l} href={u} target="_blank" rel="noopener noreferrer" style={{ fontSize:9, fontWeight:600, letterSpacing:1.5, color:T.txM, fontFamily:T.mono, textDecoration:"none" }}
              onMouseEnter={e => e.currentTarget.style.color = T.g} onMouseLeave={e => e.currentTarget.style.color = T.txM}>{l}</a>
          ))}
        </div>
        <span style={{ fontSize:9, color:T.txG, fontFamily:T.mono }}>Copy with conviction, not hope</span>
      </div>
    </div>
  );
}
