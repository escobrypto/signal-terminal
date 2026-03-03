import { useState, useEffect, useMemo, useCallback } from "react";

const HK = "efb053d6-f7c7-4c90-9bc5-0ce3af9c59df";
const BK = "94ba9de0953642878038f5a7eccc1114";
const HRPC = `https://mainnet.helius-rpc.com/?api-key=${HK}`;
const HAPI = "https://api.helius.xyz/v0";
const BIRD = "https://public-api.birdeye.so";
const DEX = "https://api.dexscreener.com";
const bH = { accept:"application/json","x-chain":"solana","X-API-KEY":BK };

const T={bg:"#060709",bg1:"#0a0b0f",bg2:"#0e0f14",s:"#1a1b24",sH:"#1f2030",brd:"#1a1b28",tx:"#c8cce0",txS:"#7d82a0",txM:"#484c68",txG:"#2e3148",g:"#10b981",gBg:"#10b98108",gBrd:"#10b98118",r:"#ef4444",rBg:"#ef444408",a:"#f59e0b",b:"#3b82f6",p:"#8b5cf6",w:"#eaecff",mono:"'Geist Mono','JetBrains Mono',monospace",sans:"'Geist','DM Sans',-apple-system,sans-serif"};

const short=(a,n=4)=>a?`${a.slice(0,n)}...${a.slice(-n)}`:"—";
const fmt=(n)=>{if(!n&&n!==0)return"—";if(Math.abs(n)>=1e9)return`$${(n/1e9).toFixed(1)}B`;if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(1)}K`;return`$${n.toFixed(0)}`};
const fmtAge=(ts)=>{if(!ts)return"—";const s=Math.floor((Date.now()-ts)/1000);if(s<60)return`${s}s`;const m=Math.floor(s/60);if(m<60)return`${m}m`;const h=Math.floor(m/60);if(h<24)return`${h}h`;return`${Math.floor(h/24)}d`};
const cp=t=>navigator.clipboard.writeText(t);
const wait=ms=>new Promise(r=>setTimeout(r,ms));

/* ═══ API ═══ */
async function hRpc(method,params){try{const r=await fetch(HRPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});const d=await r.json();return d.result||null}catch{return null}}
async function hParsed(addr,limit=50){try{const r=await fetch(`${HAPI}/addresses/${addr}/transactions?api-key=${HK}&limit=${limit}`);return r.ok?await r.json():[]}catch{return[]}}
async function hSwaps(addr,limit=50){try{const r=await fetch(`${HAPI}/addresses/${addr}/transactions?api-key=${HK}&limit=${limit}&type=SWAP`);return r.ok?await r.json():[]}catch{return[]}}
async function birdOver(addr){try{const r=await fetch(`${BIRD}/defi/token_overview?address=${addr}`,{headers:bH});const d=await r.json();return d.data||null}catch{return null}}
async function birdPort(w){try{const r=await fetch(`${BIRD}/v1/wallet/token_list?wallet=${w}`,{headers:bH});const d=await r.json();return d.data?.items||[]}catch{return[]}}
async function birdPrice(addr){try{const r=await fetch(`${BIRD}/defi/price?address=${addr}`,{headers:bH});const d=await r.json();return d.data||null}catch{return null}}

// Get top holders of a token
async function getHolders(mint){const r=await hRpc("getTokenLargestAccounts",[mint]);return r?.value||[]}
async function getSupply(mint){const r=await hRpc("getTokenSupply",[mint]);return r?.value||null}

// Get token accounts for a wallet (to find what they hold)
async function getAccounts(wallet){
  const r=await hRpc("getTokenAccountsByOwner",[wallet,{programId:"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},{encoding:"jsonParsed"}]);
  return r?.value||[];
}

// Resolve token account owner
async function getAccountInfo(pubkey){
  const r=await hRpc("getAccountInfo",[pubkey,{encoding:"jsonParsed"}]);
  return r?.value||null;
}

// Parse swaps into structured trades
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
    if(mint)out.push({action,mint,solAmt,time,sig,src});
  }
  return out;
}

// Analyze a wallet's swap history → win rate, PNL per token
function analyzeSwaps(swaps){
  const tokens={};
  for(const s of swaps){
    if(!tokens[s.mint])tokens[s.mint]={buys:[],sells:[],totalBuy:0,totalSell:0};
    if(s.action==="BUY"){tokens[s.mint].buys.push(s);tokens[s.mint].totalBuy+=s.solAmt}
    else{tokens[s.mint].sells.push(s);tokens[s.mint].totalSell+=s.solAmt}
  }
  let wins=0,losses=0,totalPnl=0;
  const tokenStats=[];
  for(const[mint,d]of Object.entries(tokens)){
    const pnl=d.totalSell-d.totalBuy;
    const roi=d.totalBuy>0?((d.totalSell-d.totalBuy)/d.totalBuy*100):0;
    const closed=d.sells.length>0;
    if(closed){if(pnl>0)wins++;else losses++}
    totalPnl+=pnl;
    tokenStats.push({mint,buys:d.buys.length,sells:d.sells.length,totalBuy:d.totalBuy,totalSell:d.totalSell,pnl,roi,closed,firstBuy:d.buys[0]?.time||0});
  }
  tokenStats.sort((a,b)=>b.pnl-a.pnl);
  const closed=wins+losses;
  const winRate=closed>0?(wins/closed*100):0;
  return{wins,losses,closed,winRate,totalPnl,tokenStats,totalTrades:swaps.length};
}

/* ═══ UI ATOMS ═══ */
const Badge=({children,color=T.g})=><span style={{fontSize:8,padding:"2px 6px",borderRadius:2,background:`${color}0d`,color,fontFamily:T.mono,fontWeight:700,letterSpacing:.5,border:`1px solid ${color}15`}}>{children}</span>;
const ActionTag=({action})=><span style={{fontSize:10,fontWeight:800,color:action==="BUY"?T.g:action==="SELL"?T.r:T.txM,fontFamily:T.mono,letterSpacing:.5}}>{action}</span>;
const CopyBtn=({text,label="COPY"})=>{const[ok,setOk]=useState(false);return<button onClick={e=>{e.stopPropagation();cp(text);setOk(true);setTimeout(()=>setOk(false),1200)}} style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${ok?T.g+"30":T.brd}`,background:ok?T.gBg:"transparent",color:ok?T.g:T.txM,fontSize:8,fontWeight:700,fontFamily:T.mono,cursor:"pointer",letterSpacing:.5}}>{ok?"✓":label}</button>};
const AxiomBtn=({mint})=><a href={`https://axiom.trade/t/${mint}/`} target="_blank" rel="noopener noreferrer" style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${T.g}20`,background:T.gBg,color:T.g,fontSize:8,fontWeight:700,fontFamily:T.mono,textDecoration:"none",letterSpacing:.5}}>AXIOM ↗</a>;
const GmgnBtn=({addr})=><a href={`https://gmgn.ai/sol/address/${addr}`} target="_blank" rel="noopener noreferrer" style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${T.p}20`,background:`${T.p}08`,color:T.p,fontSize:8,fontWeight:700,fontFamily:T.mono,textDecoration:"none",letterSpacing:.5}}>GMGN ↗</a>;
const Stat=({label,value,color})=><div><div style={{fontSize:8,color:T.txM,letterSpacing:1,fontWeight:600,fontFamily:T.mono,textTransform:"uppercase",marginBottom:3}}>{label}</div><div style={{fontSize:14,fontWeight:700,fontFamily:T.mono,color:color||T.w,lineHeight:1}}>{value}</div></div>;
const Section=({children,sub})=><div style={{marginBottom:12}}><div style={{fontSize:10,fontWeight:700,letterSpacing:2.5,color:T.txM,fontFamily:T.mono,textTransform:"uppercase",paddingBottom:6,borderBottom:`1px solid ${T.brd}`}}>{children}</div>{sub&&<div style={{fontSize:9,color:T.txG,fontFamily:T.mono,marginTop:4}}>{sub}</div>}</div>;
const Input=({value,onChange,placeholder,onSubmit,flex=1})=><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onKeyDown={e=>e.key==="Enter"&&onSubmit?.()} style={{flex,padding:"8px 12px",borderRadius:4,background:T.bg2,border:`1px solid ${T.brd}`,color:T.tx,fontSize:11,fontFamily:T.mono,outline:"none"}} onFocus={e=>e.target.style.borderColor=T.g+"40"} onBlur={e=>e.target.style.borderColor=T.brd}/>;
const Btn=({onClick,disabled,children,color=T.g})=><button onClick={onClick} disabled={disabled} style={{padding:"8px 18px",borderRadius:4,background:disabled?T.bg2:`${color}08`,border:`1px solid ${disabled?T.brd:color+"25"}`,color:disabled?T.txM:color,fontSize:9,fontWeight:700,letterSpacing:1,fontFamily:T.mono,cursor:disabled?"default":"pointer"}}>{children}</button>;

const WinRateBar=({rate,w=60})=>{const c=rate>=60?T.g:rate>=45?T.a:T.r;return<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:w,height:4,borderRadius:2,background:T.bg,overflow:"hidden"}}><div style={{width:`${Math.min(rate,100)}%`,height:"100%",borderRadius:2,background:c,opacity:.7}}/></div><span style={{fontSize:11,fontWeight:700,color:c,fontFamily:T.mono}}>{rate.toFixed(0)}%</span></div>};

/* ═══════════════════════════════════════════════
   DISCOVER — Find wallets from a winning token
   ═══════════════════════════════════════════════ */
const Discover = ({onAddWallet}) => {
  const [mint, setMint] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState([]);
  const [tokenInfo, setTokenInfo] = useState(null);

  const discover = async () => {
    if (!mint.trim()) return;
    setLoading(true); setResults([]); setTokenInfo(null);
    const addr = mint.trim();

    setStatus("Fetching token info...");
    const info = await birdOver(addr);
    setTokenInfo(info);

    setStatus("Finding top holders...");
    const holders = await getHolders(addr);
    if (!holders.length) { setStatus("No holders found. Check the CA."); setLoading(false); return; }

    // Resolve token account → owner wallet
    setStatus(`Resolving ${holders.length} holder wallets...`);
    const wallets = [];
    for (let i = 0; i < Math.min(holders.length, 20); i++) {
      const h = holders[i];
      try {
        const accInfo = await getAccountInfo(h.address);
        const owner = accInfo?.data?.parsed?.info?.owner;
        if (owner && !wallets.find(w => w.owner === owner)) {
          wallets.push({ owner, tokenAccount: h.address, amount: parseFloat(h.uiAmount || h.amount || "0") });
        }
      } catch {}
      await wait(100);
    }

    if (!wallets.length) { setStatus("Could not resolve wallets."); setLoading(false); return; }

    // Analyze each wallet's trade history
    setStatus(`Analyzing ${wallets.length} wallets...`);
    const analyzed = [];
    for (const w of wallets.slice(0, 15)) {
      setStatus(`Analyzing ${short(w.owner)}...`);
      try {
        const swaps = await hSwaps(w.owner, 50);
        const parsed = parseSwaps(swaps);
        if (parsed.length < 3) continue; // skip inactive
        const stats = analyzeSwaps(parsed);
        analyzed.push({
          addr: w.owner,
          ...stats,
          recentSwaps: parsed.slice(0, 5),
        });
      } catch {}
      await wait(200);
    }

    analyzed.sort((a, b) => {
      // Score: win rate * log(trades) * pnl direction
      const scoreA = a.winRate * Math.log2(Math.max(a.closed, 1)) * (a.totalPnl > 0 ? 1.5 : 0.5);
      const scoreB = b.winRate * Math.log2(Math.max(b.closed, 1)) * (b.totalPnl > 0 ? 1.5 : 0.5);
      return scoreB - scoreA;
    });

    setResults(analyzed);
    setStatus(`Found ${analyzed.length} tradeable wallets from top holders.`);
    setLoading(false);
  };

  return (
    <div>
      <Section sub="Paste a token that pumped → finds who bought early → analyzes their trade history → surfaces wallets with highest win rates">DISCOVER WALLETS</Section>
      
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <Input value={mint} onChange={setMint} placeholder="Paste token CA that recently pumped..." onSubmit={discover} />
        <Btn onClick={discover} disabled={loading}>{loading ? "SCANNING..." : "FIND WALLETS"}</Btn>
      </div>

      {status && <div style={{ fontSize:10, color:loading?T.b:T.txS, fontFamily:T.mono, marginBottom:12, padding:"6px 10px", borderRadius:4, background:T.bg2 }}>{status}</div>}

      {tokenInfo && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:14, padding:"12px 16px", background:T.bg2, borderRadius:6, border:`1px solid ${T.brd}`, marginBottom:16 }}>
          <Stat label="Token" value={tokenInfo.symbol ? `$${tokenInfo.symbol}` : "?"} />
          <Stat label="MC" value={fmt(tokenInfo.mc || tokenInfo.marketCap || 0)} />
          <Stat label="Liquidity" value={fmt(tokenInfo.liquidity || 0)} />
          <Stat label="Holders" value={(tokenInfo.holder || 0).toLocaleString()} />
        </div>
      )}

      {results.map((r, i) => (
        <div key={r.addr} style={{ padding:"12px 14px", borderRadius:6, border:`1px solid ${r.winRate>=60?T.g+"15":T.brd}`, marginBottom:6, background:r.winRate>=60?T.gBg:"transparent" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:11, fontWeight:700, color:T.w, fontFamily:T.mono }}>#{i+1}</span>
              <span style={{ fontSize:11, color:T.b, fontFamily:T.mono, cursor:"pointer" }} onClick={()=>cp(r.addr)}>{short(r.addr, 6)}</span>
              <WinRateBar rate={r.winRate} />
              {r.winRate >= 60 && <Badge color={T.g}>HIGH WR</Badge>}
              {r.totalPnl > 5 && <Badge color={T.g}>PROFITABLE</Badge>}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <CopyBtn text={r.addr} label="WALLET" />
              <GmgnBtn addr={r.addr} />
              <button onClick={()=>onAddWallet(r.addr, `D-${i+1}`, r.winRate)} style={{ padding:"3px 10px", borderRadius:3, border:`1px solid ${T.g}25`, background:T.gBg, color:T.g, fontSize:8, fontWeight:700, fontFamily:T.mono, cursor:"pointer", letterSpacing:.5 }}>+ TRACK</button>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:12 }}>
            <Stat label="Win Rate" value={`${r.winRate.toFixed(0)}%`} color={r.winRate>=60?T.g:r.winRate>=45?T.a:T.r} />
            <Stat label="W / L" value={`${r.wins}/${r.losses}`} />
            <Stat label="Trades" value={r.totalTrades} />
            <Stat label="PNL (SOL)" value={`${r.totalPnl>=0?"+":""}${r.totalPnl.toFixed(2)}`} color={r.totalPnl>=0?T.g:T.r} />
            <Stat label="Best" value={r.tokenStats[0]?`+${r.tokenStats[0].pnl.toFixed(1)} SOL`:"—"} color={T.g} />
            <Stat label="Worst" value={r.tokenStats.length?`${r.tokenStats[r.tokenStats.length-1].pnl.toFixed(1)} SOL`:"—"} color={T.r} />
          </div>
          {r.tokenStats.length>0 && (
            <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:2 }}>
              <div style={{ fontSize:8, color:T.txM, fontFamily:T.mono, letterSpacing:1 }}>RECENT TOKEN P&L</div>
              {r.tokenStats.slice(0,5).map((ts,j)=>(
                <div key={j} style={{ display:"grid", gridTemplateColumns:"100px 60px 60px 80px 60px", gap:8, fontSize:10, fontFamily:T.mono, padding:"3px 6px", borderRadius:2, background:j%2===0?"transparent":T.bg2+"30" }}>
                  <span style={{ color:T.txS, cursor:"pointer" }} onClick={()=>cp(ts.mint)}>{short(ts.mint)}</span>
                  <span style={{ color:T.txM }}>{ts.buys}B / {ts.sells}S</span>
                  <span style={{ color:T.txM }}>In: {ts.totalBuy.toFixed(2)}</span>
                  <span style={{ color:T.txM }}>Out: {ts.totalSell.toFixed(2)}</span>
                  <span style={{ color:ts.pnl>=0?T.g:T.r, fontWeight:600 }}>{ts.pnl>=0?"+":""}{ts.pnl.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════
   VALIDATE — Deep dive any wallet
   ═══════════════════════════════════════════════ */
const Validate = ({onAddWallet}) => {
  const [addr, setAddr] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [holdings, setHoldings] = useState(null);

  const validate = async () => {
    if (!addr.trim()) return;
    setLoading(true); setResult(null); setHoldings(null);
    const w = addr.trim();

    const [swapTxns, portfolio] = await Promise.allSettled([
      hSwaps(w, 100),
      birdPort(w),
    ]);

    const swaps = swapTxns.status === "fulfilled" ? parseSwaps(swapTxns.value) : [];
    const stats = analyzeSwaps(swaps);
    setResult({ addr: w, ...stats, rawSwaps: swaps });

    const port = portfolio.status === "fulfilled" ? portfolio.value : [];
    const hold = port.filter(t => t.uiAmount > 0 && t.symbol !== "SOL").sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
    const solBal = port.find(t => t.symbol === "SOL");
    setHoldings({ tokens: hold.slice(0, 20), sol: solBal?.uiAmount || 0, totalVal: hold.reduce((s, t) => s + (t.valueUsd || 0), 0) });

    setLoading(false);
  };

  const r = result;

  return (
    <div>
      <Section sub="Paste any wallet → get full trade history analysis with win rate, PNL breakdown, current holdings">VALIDATE WALLET</Section>

      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <Input value={addr} onChange={setAddr} placeholder="Paste wallet address to analyze..." onSubmit={validate} />
        <Btn onClick={validate} disabled={loading}>{loading ? "ANALYZING..." : "VALIDATE"}</Btn>
      </div>

      {r && (
        <div>
          {/* Score Card */}
          <div style={{ padding:"16px 18px", borderRadius:8, border:`1px solid ${r.winRate>=60?T.g+"20":r.winRate>=45?T.a+"20":T.r+"20"}`, background:r.winRate>=60?T.gBg:r.winRate>=45?`${T.a}08`:T.rBg, marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:10, color:T.txM, fontFamily:T.mono, cursor:"pointer" }} onClick={()=>cp(r.addr)}>{short(r.addr, 8)}</span>
                {r.winRate>=60 && <Badge color={T.g}>WORTH COPYING</Badge>}
                {r.winRate>=45 && r.winRate<60 && <Badge color={T.a}>MIXED</Badge>}
                {r.winRate<45 && <Badge color={T.r}>RISKY</Badge>}
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <CopyBtn text={r.addr} label="WALLET" />
                <GmgnBtn addr={r.addr} />
                <button onClick={()=>onAddWallet(r.addr, `V-${Date.now()%1000}`, r.winRate)} style={{ padding:"3px 10px", borderRadius:3, border:`1px solid ${T.g}25`, background:T.gBg, color:T.g, fontSize:8, fontWeight:700, fontFamily:T.mono, cursor:"pointer" }}>+ TRACK</button>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:14 }}>
              <div><div style={{ fontSize:8, color:T.txM, letterSpacing:1, fontWeight:600, fontFamily:T.mono, marginBottom:4 }}>WIN RATE</div><WinRateBar rate={r.winRate} w={80} /></div>
              <Stat label="W / L" value={`${r.wins} / ${r.losses}`} />
              <Stat label="Closed" value={r.closed} />
              <Stat label="Total Swaps" value={r.totalTrades} />
              <Stat label="Net PNL" value={`${r.totalPnl>=0?"+":""}${r.totalPnl.toFixed(2)} SOL`} color={r.totalPnl>=0?T.g:T.r} />
              <Stat label="Tokens Traded" value={r.tokenStats.length} />
            </div>
          </div>

          {/* Holdings */}
          {holdings && (
            <div style={{ marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <span style={{ fontSize:9, color:T.b, fontFamily:T.mono, letterSpacing:2, fontWeight:700 }}>CURRENT HOLDINGS</span>
                <span style={{ fontSize:9, color:T.txM, fontFamily:T.mono }}>{holdings.sol.toFixed(2)} SOL · {fmt(holdings.totalVal)} portfolio</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                {holdings.tokens.map((tk, j) => (
                  <div key={j} style={{ display:"grid", gridTemplateColumns:"80px 1fr 70px 60px 80px", alignItems:"center", gap:6, padding:"5px 8px", borderRadius:3, background:j%2===0?"transparent":T.bg2+"30", fontSize:10, fontFamily:T.mono }}>
                    <span style={{ color:T.b, fontWeight:600 }}>{tk.symbol || "???"}</span>
                    <span style={{ color:T.txG, cursor:"pointer" }} onClick={()=>cp(tk.address)}>{short(tk.address)}</span>
                    <span style={{ color:T.txS, textAlign:"right" }}>{tk.uiAmount>1e6?`${(tk.uiAmount/1e6).toFixed(1)}M`:tk.uiAmount>1e3?`${(tk.uiAmount/1e3).toFixed(1)}K`:tk.uiAmount?.toFixed(1)}</span>
                    <span style={{ color:tk.valueUsd>100?T.g:T.txM, textAlign:"right", fontWeight:600 }}>{tk.valueUsd>0?fmt(tk.valueUsd):"—"}</span>
                    <div style={{ display:"flex", gap:3, justifyContent:"flex-end" }}><CopyBtn text={tk.address} label="CA" /><AxiomBtn mint={tk.address} /></div>
                  </div>
                ))}
                {!holdings.tokens.length && <span style={{ fontSize:10, color:T.txM, fontFamily:T.mono, padding:8 }}>No token holdings found</span>}
              </div>
            </div>
          )}

          {/* Token PNL Breakdown */}
          <div style={{ fontSize:9, color:T.p, fontFamily:T.mono, letterSpacing:2, fontWeight:700, marginBottom:8 }}>TOKEN P&L BREAKDOWN</div>
          <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
            {r.tokenStats.map((ts, j) => (
              <div key={j} style={{ display:"grid", gridTemplateColumns:"100px 50px 50px 70px 70px 60px 60px", alignItems:"center", gap:6, padding:"5px 8px", borderRadius:3, background:j%2===0?"transparent":T.bg2+"20", fontSize:10, fontFamily:T.mono }}>
                <span style={{ color:T.txS, cursor:"pointer" }} onClick={()=>cp(ts.mint)}>{short(ts.mint)}</span>
                <span style={{ color:T.txM }}>{ts.buys}B</span>
                <span style={{ color:T.txM }}>{ts.sells}S</span>
                <span style={{ color:T.txM }}>In: {ts.totalBuy.toFixed(2)}</span>
                <span style={{ color:T.txM }}>Out: {ts.totalSell.toFixed(2)}</span>
                <span style={{ color:ts.pnl>=0?T.g:T.r, fontWeight:700 }}>{ts.pnl>=0?"+":""}{ts.pnl.toFixed(2)}</span>
                <span style={{ color:ts.roi>=0?T.g:T.r, fontSize:9 }}>{ts.closed?`${ts.roi>=0?"+":""}${ts.roi.toFixed(0)}%`:"OPEN"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!r && !loading && <div style={{ padding:40, textAlign:"center", color:T.txM, fontSize:11, fontFamily:T.mono, background:T.bg2, borderRadius:6, border:`1px solid ${T.brd}` }}>Paste a wallet above. Pulls last 100 swaps via Helius, calculates win rate and PNL per token.</div>}
    </div>
  );
};

/* ═══════════════════════════════════════════════
   WATCHLIST — Track validated wallets live
   ═══════════════════════════════════════════════ */
const Watchlist = ({wallets, setWallets}) => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tInfo, setTInfo] = useState({});

  const loadFeed = useCallback(async () => {
    if (!wallets.length) return;
    setLoading(true);
    const all = [];
    const results = await Promise.allSettled(
      wallets.map(async w => {
        const txns = await hSwaps(w.addr, 12);
        return parseSwaps(txns).map(s => ({ ...s, tag: w.tag, walletAddr: w.addr, wr: w.winRate }));
      })
    );
    results.forEach(r => { if (r.status === "fulfilled") all.push(...r.value) });
    all.sort((a, b) => b.time - a.time);
    setTrades(all.slice(0, 80));
    setLoading(false);

    // Fetch token info
    const mints = [...new Set(all.map(t => t.mint).filter(Boolean))].slice(0, 10);
    for (const m of mints) {
      if (!tInfo[m]) {
        const info = await birdOver(m);
        if (info) setTInfo(p => ({ ...p, [m]: info }));
        await wait(200);
      }
    }
  }, [wallets]);

  useEffect(() => { loadFeed() }, [loadFeed]);

  const convergence = useMemo(() => {
    const map = {};
    trades.filter(t => t.action === "BUY").forEach(t => {
      if (!map[t.mint]) map[t.mint] = new Set();
      map[t.mint].add(t.tag);
    });
    return Object.entries(map).filter(([_, w]) => w.size >= 2).map(([mint, w]) => ({ mint, count: w.size, names: [...w] }));
  }, [trades]);

  const remove = (addr) => setWallets(p => p.filter(w => w.addr !== addr));

  return (
    <div>
      <Section sub={`${wallets.length} wallets tracked · Convergence alerts when multiple wallets buy the same token`}>WATCHLIST</Section>

      {!wallets.length && <div style={{ padding:40, textAlign:"center", color:T.txM, fontSize:11, fontFamily:T.mono, background:T.bg2, borderRadius:6, border:`1px solid ${T.brd}` }}>No wallets tracked yet. Use DISCOVER or VALIDATE to find wallets, then click "+ TRACK" to add them here.</div>}

      {/* Wallet chips */}
      {wallets.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
          {wallets.map(w => (
            <div key={w.addr} style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px", borderRadius:4, background:T.bg2, border:`1px solid ${T.brd}`, fontSize:9, fontFamily:T.mono }}>
              <span style={{ color:T.g, fontWeight:700 }}>{w.tag}</span>
              <span style={{ color:T.txM }}>{short(w.addr)}</span>
              <span style={{ color:w.winRate>=60?T.g:w.winRate>=45?T.a:T.txM }}>{w.winRate?.toFixed(0)||"?"}% WR</span>
              <button onClick={()=>remove(w.addr)} style={{ background:"none", border:"none", color:T.r, cursor:"pointer", fontSize:10, fontFamily:T.mono, padding:0 }}>✕</button>
            </div>
          ))}
          <Btn onClick={loadFeed} disabled={loading}>{loading?"···":"REFRESH"}</Btn>
        </div>
      )}

      {/* Convergence */}
      {convergence.length > 0 && (
        <div style={{ marginBottom:16, padding:"14px 16px", borderRadius:8, background:T.gBg, border:`1px solid ${T.gBrd}` }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:2.5, color:T.g, fontFamily:T.mono, marginBottom:10 }}>⚡ CONVERGENCE</div>
          {convergence.map((c, i) => {
            const info = tInfo[c.mint];
            return (
              <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", borderRadius:4, background:T.bg2, marginBottom:4 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:T.w, fontFamily:T.sans }}>{info?.symbol ? `$${info.symbol}` : short(c.mint, 6)}</span>
                  <Badge color={T.g}>{c.count} WALLETS</Badge>
                  <span style={{ fontSize:9, color:T.txM, fontFamily:T.mono }}>{c.names.join(" · ")}</span>
                  {info?.mc && <span style={{ fontSize:9, color:T.txM, fontFamily:T.mono }}>MC {fmt(info.mc)}</span>}
                </div>
                <div style={{ display:"flex", gap:4 }}><CopyBtn text={c.mint} label="CA" /><AxiomBtn mint={c.mint} /></div>
              </div>
            );
          })}
        </div>
      )}

      {/* Feed */}
      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
        {trades.map((t, i) => {
          const info = tInfo[t.mint];
          return (
            <div key={t.sig+i} style={{ display:"grid", gridTemplateColumns:"32px 80px 1fr 80px 100px", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:4, background:i%2===0?"transparent":T.bg2+"40" }}
              onMouseEnter={e=>e.currentTarget.style.background=T.sH}
              onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":T.bg2+"40"}>
              <ActionTag action={t.action} />
              <span style={{ fontSize:10, fontWeight:700, color:T.g, fontFamily:T.mono }}>{t.tag}</span>
              <div>
                <span style={{ fontSize:11, fontWeight:600, color:T.w, fontFamily:T.sans }}>{info?.symbol?`$${info.symbol}`:short(t.mint,5)}</span>
                {t.solAmt>0 && <span style={{ fontSize:9, color:t.action==="BUY"?T.g:T.r, fontFamily:T.mono, marginLeft:8 }}>{t.solAmt.toFixed(2)} SOL</span>}
                <span style={{ fontSize:9, color:T.txG, fontFamily:T.mono, marginLeft:8 }}>{t.src} · {fmtAge(t.time)}</span>
              </div>
              <span style={{ fontSize:9, color:T.txG, fontFamily:T.mono, textAlign:"right" }}>{short(t.mint)}</span>
              <div style={{ display:"flex", gap:4, justifyContent:"flex-end" }}><CopyBtn text={t.mint} label="CA" /><AxiomBtn mint={t.mint} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ═══ MAIN ═══ */
export default function App() {
  const [tab, setTab] = useState("discover");
  const [wallets, setWallets] = useState([]);

  const addWallet = (addr, tag, winRate) => {
    if (wallets.find(w => w.addr === addr)) return;
    setWallets(p => [...p, { addr, tag, winRate }]);
  };

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
            <div style={{ fontSize:8, color:T.txM, fontFamily:T.mono, letterSpacing:2.5, marginTop:1 }}>WALLET DISCOVERY ENGINE</div>
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

      <div style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 24px", borderBottom:`1px solid ${T.brd}` }}>
        {[
          ["discover","DISCOVER","Token → Find wallets"],
          ["validate","VALIDATE","Wallet → Get stats"],
          ["watchlist","WATCHLIST",`${wallets.length} tracked`],
        ].map(([id,l,desc]) => (
          <button key={id} onClick={()=>setTab(id)} style={{ padding:"8px 20px", borderRadius:5, border:`1px solid ${tab===id?T.g+"20":T.brd}`, cursor:"pointer", fontSize:10, fontWeight:600, letterSpacing:1.2, fontFamily:T.mono, background:tab===id?T.gBg:"transparent", color:tab===id?T.g:T.txM }}>
            {l}<div style={{ fontSize:8, color:tab===id?T.g+"80":T.txG, fontWeight:400, marginTop:2 }}>{desc}</div>
          </button>
        ))}
      </div>

      <div style={{ padding:"18px 24px 80px" }}>
        {tab==="discover" && <Discover onAddWallet={addWallet} />}
        {tab==="validate" && <Validate onAddWallet={addWallet} />}
        {tab==="watchlist" && <Watchlist wallets={wallets} setWallets={setWallets} />}
      </div>

      <div style={{ position:"fixed", bottom:0, left:0, right:0, padding:"8px 24px", borderTop:`1px solid ${T.brd}`, background:T.bg1, display:"flex", justifyContent:"space-between", alignItems:"center", zIndex:50 }}>
        <div style={{ display:"flex", gap:16 }}>
          {[["AXIOM","https://axiom.trade"],["GMGN","https://gmgn.ai"],["DEXSCREENER","https://dexscreener.com"]].map(([l,u]) => (
            <a key={l} href={u} target="_blank" rel="noopener noreferrer" style={{ fontSize:9, fontWeight:600, letterSpacing:1.5, color:T.txM, fontFamily:T.mono, textDecoration:"none" }} onMouseEnter={e=>e.currentTarget.style.color=T.g} onMouseLeave={e=>e.currentTarget.style.color=T.txM}>{l}</a>
          ))}
        </div>
        <span style={{ fontSize:9, color:T.txG, fontFamily:T.mono }}>Find the wallets. Validate the edge. Copy with conviction.</span>
      </div>
    </div>
  );
}
