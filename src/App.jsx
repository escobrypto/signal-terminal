import { useState, useCallback } from "react";

const HK = "efb053d6-f7c7-4c90-9bc5-0ce3af9c59df";
const BK = "94ba9de0953642878038f5a7eccc1114";
const RPC = `https://mainnet.helius-rpc.com/?api-key=${HK}`;
const HAPI = `https://api.helius.xyz/v0`;
const BAPI = `https://public-api.birdeye.so`;
const C = { bg:"#05070b",bgS:"#0a0e17",bgC:"#0d1219",bgH:"#121a27",bd:"#161f30",bdH:"#1e3a2a",g:"#00ff88",gD:"#00ff8820",gM:"#00cc6a",gG:"#00ff8840",r:"#ff2e4c",rD:"#ff2e4c18",y:"#ffc800",yD:"#ffc80018",c:"#00cfff",cD:"#00cfff18",p:"#b44dff",o:"#ff8c00",t:"#dfe6f0",tS:"#5a6e8a",tM:"#2d3d56" };

async function rpc(method,params){try{const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});const d=await r.json();return d.result||null}catch(e){return null}}
async function bGet(ep,params={}){try{const u=new URL(`${BAPI}${ep}`);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{headers:{"X-API-KEY":BK,"x-chain":"solana"}});return await r.json()}catch(e){return null}}
async function getOverview(a){const d=await bGet("/defi/token_overview",{address:a});return d?.data||null}
async function getSecurity(a){const d=await bGet("/defi/token_security",{address:a});return d?.data||null}
async function getHolders(mint){const lg=await rpc("getTokenLargestAccounts",[mint]);if(!lg?.value)return[];const out=[];for(const ac of lg.value.slice(0,20)){try{const info=await rpc("getAccountInfo",[ac.address,{encoding:"jsonParsed"}]);const p=info?.value?.data?.parsed?.info;if(p)out.push({tAcc:ac.address,owner:p.owner,amt:parseFloat(p.tokenAmount?.uiAmountString||"0"),raw:ac.amount});else out.push({tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0"),raw:ac.amount})}catch(e){out.push({tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0"),raw:ac.amount})}}return out}
async function getSolBal(a){const r=await rpc("getBalance",[a]);return r?r/1e9:0}
async function getTxs(a){try{const r=await fetch(`${HAPI}/addresses/${a}/transactions?api-key=${HK}&limit=10`);return await r.json()}catch(e){return[]}}
async function getPortfolio(a){const d=await bGet("/v1/wallet/token_list",{wallet:a});return d?.data?.items||[]}

const tr=(a,n=4)=>a?`${a.slice(0,n)}...${a.slice(-n)}`:"—";
const ago=ts=>{if(!ts)return"—";const s=Math.floor(Date.now()/1000-ts);if(s<0)return"now";if(s<60)return s+"s";if(s<3600)return Math.floor(s/60)+"m";if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d"};
const $=(n)=>{if(!n&&n!==0)return"—";if(n>=1e9)return`$${(n/1e9).toFixed(2)}B`;if(n>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(n>=1e3)return`$${(n/1e3).toFixed(1)}K`;return`$${parseFloat(n).toFixed(2)}`};
const pct=n=>n!=null?`${n>=0?"+":""}${parseFloat(n).toFixed(2)}%`:"—";
const fp=n=>{if(!n)return"—";if(n<0.00001)return`$${parseFloat(n).toExponential(2)}`;if(n<0.01)return`$${parseFloat(n).toFixed(6)}`;if(n<1)return`$${parseFloat(n).toFixed(4)}`;return`$${parseFloat(n).toFixed(2)}`};

function classify(h,all,txs=[]){const p=h.pct;const fl=[];let lb="Holder",rs=0;if(p>10){lb="Whale";rs+=25;fl.push({s:"w",t:`Holds ${p.toFixed(2)}% — whale`})}else if(p>5){lb="Large";rs+=15;fl.push({s:"w",t:`Holds ${p.toFixed(2)}% — large`})}else if(p>2){lb="Mid";rs+=5}else if(p<0.01){lb="Dust";rs+=10;fl.push({s:"i",t:"Dust holding"})}
if(txs.length>2){const ts=txs.map(t=>t.timestamp).filter(Boolean).sort();const gaps=[];for(let i=1;i<ts.length;i++)gaps.push(Math.abs(ts[i]-ts[i-1]));const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length;if(avg<5){lb="Sniper Bot";rs+=35;fl.push({s:"c",t:"Sub-5s TX gaps — bot"})}else if(avg<30){lb="Fast Trader";rs+=15;fl.push({s:"w",t:"Rapid trading pattern"})}}
if(txs.length>0){const sw=txs.filter(t=>t.type==="SWAP").length;if(sw>8)fl.push({s:"i",t:`${sw} swaps — active trader`})}
if(h.owner?.startsWith("1111")){lb="System/Burn";rs=0;fl.push({s:"g",t:"System/burn address"})}
if(!fl.length)fl.push({s:"g",t:"No anomalies"});return{lb,rs:Math.min(rs,100),fl}}

function rugDNA(holders,sec){const t10=holders.slice(0,10).reduce((s,h)=>s+h.pct,0);const t5=holders.slice(0,5).reduce((s,h)=>s+h.pct,0);let sc=0;const f=[];
if(t10>70){sc+=35;f.push({s:"c",t:`Top 10 control ${t10.toFixed(1)}% — extreme`})}else if(t10>50){sc+=20;f.push({s:"w",t:`Top 10 control ${t10.toFixed(1)}% — moderate`})}else f.push({s:"g",t:`Top 10 hold ${t10.toFixed(1)}% — distributed`});
if(t5>50){sc+=15;f.push({s:"c",t:`Top 5 alone hold ${t5.toFixed(1)}%`})}
const wh=holders.filter(h=>h.pct>5);if(wh.length>3){sc+=15;f.push({s:"w",t:`${wh.length} wallets >5% each`})}
if(sec){if(sec.isMintable){sc+=25;f.push({s:"c",t:"MINTABLE — supply can inflate"})}if(sec.isFreezable){sc+=20;f.push({s:"c",t:"FREEZABLE — accounts can freeze"})}if(!sec.isMintable&&!sec.isFreezable)f.push({s:"g",t:"Not mintable, not freezable"})}
const hr=holders.filter(h=>h.rs>60).length;if(hr>5){sc+=10;f.push({s:"w",t:`${hr} high risk wallets`})}
if(sc<=10)f.unshift({s:"g",t:"No major red flags"});
sc=Math.min(sc,100);const lv=sc>60?"HIGH RISK":sc>30?"MEDIUM":"LOW RISK";
return{sc,lv,f,st:{t10,t5,wh:wh.length,hr,n:holders.length,mint:sec?.isMintable||false,freeze:sec?.isFreezable||false}}}

// ─── UI ATOMS ───────────────────────────────────────────
const Badge=({text,color=C.g})=><span style={{display:"inline-block",padding:"2px 7px",fontSize:9,fontWeight:700,color,background:`${color}15`,border:`1px solid ${color}30`,borderRadius:3,letterSpacing:1.2,textTransform:"uppercase",fontFamily:"inherit",whiteSpace:"nowrap"}}>{text}</span>;
const Dot=({color=C.g,label="LIVE"})=><span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:10,color,letterSpacing:1.5}}><span style={{width:6,height:6,borderRadius:"50%",background:color,boxShadow:`0 0 8px ${color}`,animation:"pulse 2s ease-in-out infinite"}}/>{label}</span>;
const RB=({score})=>{const co=score>60?C.r:score>30?C.y:C.g;return<div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:100,height:5,background:`${C.tM}33`,borderRadius:3,overflow:"hidden"}}><div style={{width:`${Math.min(score,100)}%`,height:"100%",borderRadius:3,background:`linear-gradient(90deg,${C.g},${score>30?C.y:C.g},${score>60?C.r:C.y})`,boxShadow:`0 0 8px ${co}44`,transition:"width 0.6s ease"}}/></div><span style={{fontSize:12,fontWeight:700,color:co}}>{score}/100</span></div>};
const St=({l,v,color=C.t,sm})=><div style={{textAlign:"center"}}><div style={{fontSize:sm?14:18,fontWeight:700,color}}>{v}</div><div style={{fontSize:8,color:C.tM,letterSpacing:1.5,marginTop:2}}>{l}</div></div>;
const KV=({k,v,color=C.t})=><div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:11}}><span style={{color:C.tS}}>{k}</span><span style={{color}}>{v}</span></div>;
const Loader=({text="SCANNING..."})=><div style={{textAlign:"center",padding:50}}><div style={{display:"inline-flex",gap:3,marginBottom:14}}>{[0,1,2,3,4,5,6].map(i=><div key={i} style={{width:3,height:20,background:C.g,borderRadius:1,animation:`pulse 0.8s ease ${i*0.1}s infinite`,boxShadow:`0 0 6px ${C.gG}`}}/>)}</div><div style={{fontSize:11,color:C.g,letterSpacing:3}}>{text}</div></div>;

const fc=s=>s==="c"?C.r:s==="w"?C.y:s==="g"?C.g:C.c;
const fi=s=>s==="c"?"✖":s==="w"?"⚠":"✓";

// ─── WALLET ROW ─────────────────────────────────────────
function WRow({h,exp,onTog,onW,sym}){
  const rc=h.rs>60?C.r:h.rs>30?C.y:C.g;
  const lc=h.lb.includes("Bot")||h.lb.includes("Sniper")?C.r:h.lb==="Whale"?C.o:h.lb.includes("System")?C.tM:C.c;
  return <div style={{background:exp?C.bgH:C.bgC,border:`1px solid ${exp?C.bdH:C.bd}`,borderRadius:5,marginBottom:3,cursor:"pointer"}}>
    <div onClick={onTog} style={{display:"grid",gridTemplateColumns:"36px 1.8fr 0.7fr 0.6fr 0.6fr 50px",alignItems:"center",padding:"9px 12px",gap:6}}>
      <span style={{fontSize:10,color:C.tM}}>#{h.rank}</span>
      <div style={{display:"flex",alignItems:"center",gap:6,overflow:"hidden"}}><span style={{fontSize:11.5,color:C.t}}>{tr(h.owner,6)}</span><Badge text={h.lb} color={lc}/></div>
      <span style={{fontSize:11.5,color:C.t,textAlign:"right"}}>{h.pct.toFixed(2)}%</span>
      <span style={{fontSize:11.5,color:rc,textAlign:"right"}}>{h.rs}</span>
      <span style={{fontSize:10,color:C.tS,textAlign:"right"}}>{h.amt?.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
      <button onClick={e=>{e.stopPropagation();onW(h)}} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.tS,cursor:"pointer",padding:"2px 6px",fontSize:9,fontFamily:"inherit"}}
        onMouseEnter={e=>{e.target.style.borderColor=C.g;e.target.style.color=C.g}} onMouseLeave={e=>{e.target.style.borderColor=C.bd;e.target.style.color=C.tS}}>+WATCH</button>
    </div>
    {exp&&<div style={{padding:"0 12px 14px",borderTop:`1px solid ${C.bd}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,animation:"fadeIn 0.25s ease"}}>
      <div style={{paddingTop:12}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>WALLET INTEL</div>
        <KV k="Address" v={tr(h.owner,10)}/><KV k="Token Acc" v={tr(h.tAcc,8)}/><KV k="SOL" v={h.sol!=null?`${h.sol.toFixed(3)} SOL`:"..."}/><KV k="Holding" v={`${h.amt?.toLocaleString(undefined,{maximumFractionDigits:2})} ${sym}`}/><KV k="% Supply" v={`${h.pct.toFixed(4)}%`}/>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:14,marginBottom:6}}>FLAGS</div>
        {h.fl.map((f,i)=><div key={i} style={{display:"flex",gap:6,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
      </div>
      <div style={{paddingTop:12}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>RECENT TXS</div>
        {(!h.txs||!h.txs.length)&&<div style={{fontSize:10,color:C.tM,padding:8}}>Loading...</div>}
        {(h.txs||[]).slice(0,6).map((tx,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 6px",marginBottom:2,borderRadius:3,background:`${C.bg}88`,fontSize:10,gap:6}}>
          <Badge text={tx.type||"TX"} color={tx.type==="SWAP"?C.c:tx.type==="TRANSFER"?C.y:C.tS}/>
          <span style={{color:C.tS,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.description?.slice(0,50)||tr(tx.signature,8)}</span>
          <span style={{color:C.tM}}>{ago(tx.timestamp)}</span>
        </div>)}
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:14,marginBottom:6}}>LINKS</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {[["Solscan",`https://solscan.io/account/${h.owner}`],["Birdeye",`https://birdeye.so/profile/${h.owner}?chain=solana`],["SolanaFM",`https://solana.fm/address/${h.owner}`]].map(([n,u])=>
            <a key={n} href={u} target="_blank" rel="noopener noreferrer" style={{padding:"2px 8px",borderRadius:3,fontSize:9,color:C.g,background:C.gD,border:`1px solid ${C.g}30`,fontFamily:"inherit"}}>{n} ↗</a>)}
        </div>
      </div>
    </div>}
  </div>;
}

// ─── RUG DNA PANEL ──────────────────────────────────────
function RDP({rd}){if(!rd)return null;const lc=rd.lv==="HIGH RISK"?C.r:rd.lv==="MEDIUM"?C.y:C.g;
  return <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,padding:16,marginBottom:10}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:12,fontWeight:700,color:C.t,letterSpacing:1.5}}>RUG DNA</span><Badge text={rd.lv} color={lc}/></div>
      <RB score={rd.sc}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:12,padding:"10px 0",borderTop:`1px solid ${C.bd}`,borderBottom:`1px solid ${C.bd}`}}>
      <St l="TOP 10%" v={`${rd.st.t10.toFixed(1)}%`} color={rd.st.t10>50?C.r:C.t} sm/><St l="TOP 5%" v={`${rd.st.t5.toFixed(1)}%`} color={rd.st.t5>40?C.r:C.t} sm/>
      <St l="WHALES" v={rd.st.wh} color={rd.st.wh>3?C.o:C.t} sm/><St l="HIGH RISK" v={rd.st.hr} color={rd.st.hr>5?C.r:C.t} sm/>
      <St l="HOLDERS" v={rd.st.n} sm/><St l="MINTABLE" v={rd.st.mint?"YES":"NO"} color={rd.st.mint?C.r:C.g} sm/><St l="FREEZABLE" v={rd.st.freeze?"YES":"NO"} color={rd.st.freeze?C.r:C.g} sm/>
    </div>
    {rd.f.map((f,i)=><div key={i} style={{display:"flex",gap:6,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
  </div>;
}

// ─── TOKEN HEADER ───────────────────────────────────────
function TH({m}){if(!m)return null;const ch=m.priceChange24hPercent||0;
  return <div style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",gap:10,marginBottom:10,padding:14,background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,alignItems:"center"}}>
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      {m.logoURI&&<img src={m.logoURI} alt="" style={{width:28,height:28,borderRadius:"50%",border:`1px solid ${C.bd}`}}/>}
      <div><div style={{fontSize:14,fontWeight:700,color:C.t}}>{m.symbol||"—"}</div><div style={{fontSize:9,color:C.tM}}>{m.name||""}</div></div>
    </div>
    <St l="PRICE" v={fp(m.price)}/><St l="MCAP" v={$(m.mc||m.marketCap)}/><St l="24H VOL" v={$(m.v24hUSD)}/><St l="LIQUIDITY" v={$(m.liquidity)}/><St l="24H" v={pct(ch)} color={ch>=0?C.g:C.r}/>
  </div>;
}

// ─── VALIDATE TAB ───────────────────────────────────────
function VTab(){const[addr,setAddr]=useState("");const[ld,setLd]=useState(false);const[data,setD]=useState(null);const[err,setErr]=useState("");
  const scan=async()=>{if(!addr.trim())return;setLd(true);setErr("");setD(null);
    try{const[bal,txs,port]=await Promise.all([getSolBal(addr),getTxs(addr),getPortfolio(addr)]);
      const tok=(port||[]).filter(t=>t.valueUsd>0.01).sort((a,b)=>(b.valueUsd||0)-(a.valueUsd||0));
      const tv=tok.reduce((s,t)=>s+(t.valueUsd||0),0);
      const tt={};(txs||[]).forEach(tx=>{const t=tx.type||"UNKNOWN";tt[t]=(tt[t]||0)+1});
      let rs=0;const fl=[];
      if(bal<0.01){rs+=15;fl.push({s:"w",t:"Very low SOL"})}
      if(!(txs||[]).length){rs+=20;fl.push({s:"w",t:"No TX history"})}
      if(tok.length>100)fl.push({s:"i",t:`${tok.length} tokens — diversified/farmer`});
      if(tok.length<3&&tv>1000){rs+=10;fl.push({s:"w",t:"Concentrated portfolio"})}
      if(!fl.length)fl.push({s:"g",t:"No anomalies"});
      setD({addr,bal,txs:txs||[],tok,tv,rs:Math.min(rs,100),fl,tt});
    }catch(e){setErr(e.message)}setLd(false)};

  return <div>
    <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:3}}>VALIDATE WALLET</div>
    <div style={{fontSize:10.5,color:C.tS,marginBottom:14}}>Wallet → SOL → portfolio → TX history → risk</div>
    <div style={{display:"flex",gap:8,marginBottom:20}}>
      <input value={addr} onChange={e=>setAddr(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="Paste wallet address..."
        style={{flex:1,padding:"11px 14px",background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,color:C.t,fontFamily:"inherit",fontSize:12,outline:"none"}}
        onFocus={e=>e.target.style.borderColor=C.g} onBlur={e=>e.target.style.borderColor=C.bd}/>
      <button onClick={scan} disabled={ld} style={{padding:"11px 24px",background:"transparent",border:`1px solid ${C.g}`,borderRadius:5,color:C.g,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:ld?"wait":"pointer",letterSpacing:2}}>
        {ld?"SCANNING...":"DEEP SCAN"}</button>
    </div>
    {err&&<div style={{color:C.r,fontSize:11,marginBottom:10,padding:"8px 12px",background:C.rD,borderRadius:4}}>{err}</div>}
    {ld&&<Loader text="DEEP SCANNING..."/>}
    {data&&!ld&&<div style={{animation:"fadeIn 0.3s ease"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
        {[["RISK",data.rs,data.rs>60?C.r:data.rs>30?C.y:C.g],["SOL",data.bal.toFixed(3),C.t],["VALUE",$(data.tv),C.t],["TOKENS",data.tok.length,C.t],["TXS",data.txs.length,C.t]].map(([l,v,c])=>
          <div key={l} style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:12,textAlign:"center"}}><div style={{fontSize:18,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:8,color:C.tM,letterSpacing:1.5,marginTop:3}}>{l}</div></div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>FLAGS</div>
          {data.fl.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
        </div>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>TX BREAKDOWN</div>
          {Object.entries(data.tt).map(([t,c])=><KV key={t} k={t} v={c}/>)}
          {!Object.keys(data.tt).length&&<div style={{fontSize:10,color:C.tM}}>No TXs</div>}
        </div>
      </div>
      <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>HOLDINGS ({data.tok.length})</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 0.8fr 0.8fr 0.8fr",padding:"4px 6px",fontSize:8,color:C.tM,letterSpacing:1,marginBottom:4}}>
          <span>TOKEN</span><span style={{textAlign:"right"}}>BAL</span><span style={{textAlign:"right"}}>VALUE</span><span style={{textAlign:"right"}}>PRICE</span>
        </div>
        {data.tok.slice(0,20).map((t,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"1fr 0.8fr 0.8fr 0.8fr",padding:"5px 6px",marginBottom:1,borderRadius:3,background:i%2?`${C.bg}55`:"transparent",fontSize:10.5,alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,overflow:"hidden"}}>{t.logoURI&&<img src={t.logoURI} alt="" style={{width:16,height:16,borderRadius:"50%"}}/>}<span style={{color:C.t,fontWeight:600}}>{t.symbol||tr(t.address,4)}</span></div>
          <span style={{color:C.tS,textAlign:"right"}}>{parseFloat(t.uiAmount||0).toLocaleString(undefined,{maximumFractionDigits:2})}</span>
          <span style={{color:C.t,textAlign:"right"}}>{$(t.valueUsd)}</span>
          <span style={{color:C.tS,textAlign:"right"}}>{fp(t.priceUsd)}</span>
        </div>)}
      </div>
      {data.txs.length>0&&<div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14,marginTop:10}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>RECENT TXS</div>
        {data.txs.slice(0,10).map((tx,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 6px",marginBottom:2,borderRadius:3,background:`${C.bg}88`,fontSize:10,gap:8}}>
          <Badge text={tx.type||"TX"} color={tx.type==="SWAP"?C.c:tx.type==="TRANSFER"?C.y:C.tS}/>
          <span style={{color:C.t,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.description?.slice(0,55)||tr(tx.signature,10)}</span>
          <span style={{color:C.tM}}>{ago(tx.timestamp)}</span>
          <a href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer" style={{color:C.g,fontSize:9}}>↗</a>
        </div>)}
      </div>}
    </div>}
  </div>;
}

// ─── WATCHLIST ───────────────────────────────────────────
function WL({wl,onRm}){
  if(!wl.length)return <div style={{textAlign:"center",padding:60}}><div style={{fontSize:30,marginBottom:10,opacity:.25}}>👁</div><div style={{fontSize:12,color:C.tS}}>No wallets watched</div><div style={{fontSize:10,color:C.tM,marginTop:4}}>+WATCH holders in Discover</div></div>;
  return <div>
    <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:10}}>WATCHED — {wl.length}</div>
    {wl.map((w,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"1.5fr 0.5fr 0.5fr 0.5fr 50px",alignItems:"center",padding:"9px 12px",gap:6,background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,marginBottom:3}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:11,color:C.t}}>{tr(w.owner,8)}</span><Badge text={w.lb} color={C.c}/></div>
      <span style={{fontSize:11,color:w.rs>60?C.r:C.g,textAlign:"right"}}>Risk:{w.rs}</span>
      <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{w.pct.toFixed(2)}%</span>
      <span style={{fontSize:10,color:C.tS,textAlign:"right"}}>{w.amt?.toLocaleString(undefined,{maximumFractionDigits:0})||"—"}</span>
      <button onClick={()=>onRm(i)} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.r,cursor:"pointer",padding:"2px 6px",fontSize:9,fontFamily:"inherit"}}>DEL</button>
    </div>)}
  </div>;
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════
export default function Signal(){
  const[tab,setTab]=useState("discover");
  const[ca,setCa]=useState("");
  const[ld,setLd]=useState(false);
  const[hl,setHl]=useState([]);
  const[rd,setRd]=useState(null);
  const[tm,setTm]=useState(null);
  const[exp,setExp]=useState(null);
  const[wl,setWl]=useState([]);
  const[sort,setSort]=useState("rank");
  const[filt,setFilt]=useState("ALL");
  const[msg,setMsg]=useState("");
  const[err,setErr]=useState("");

  const loadDetail=useCallback(async(owner)=>{
    const idx=hl.findIndex(h=>h.owner===owner);if(idx===-1)return;
    const h=hl[idx];if(h.sol!=null&&h.txs?.length)return;
    try{const[bal,txs]=await Promise.all([getSolBal(owner),getTxs(owner)]);
      const up=[...hl];up[idx]={...up[idx],sol:bal,txs:txs||[]};
      const rc=classify(up[idx],up,txs||[]);up[idx].lb=rc.lb;up[idx].rs=rc.rs;up[idx].fl=rc.fl;
      setHl(up);
    }catch(e){}
  },[hl]);

  const toggle=owner=>{if(exp===owner)setExp(null);else{setExp(owner);loadDetail(owner)}};

  const discover=async()=>{if(!ca.trim())return;setLd(true);setErr("");setHl([]);setRd(null);setTm(null);setExp(null);setMsg("Fetching token...");
    try{
      setMsg("Birdeye overview...");
      const[ov,sec]=await Promise.all([getOverview(ca),getSecurity(ca)]);
      if(ov)setTm(ov);
      setMsg("Helius holders...");
      const raw=await getHolders(ca);
      if(!raw?.length){setErr("No holders found — check mint address");setLd(false);return}
      const tot=raw.reduce((s,h)=>s+h.amt,0);
      const en=raw.map((h,i)=>({...h,rank:i+1,pct:tot>0?(h.amt/tot)*100:0,txs:[],sol:null}));
      setMsg("Classifying...");
      for(const h of en){const c=classify(h,en,[]);h.lb=c.lb;h.rs=c.rs;h.fl=c.fl}
      setHl(en);
      setMsg("Rug DNA...");
      setRd(rugDNA(en,sec));
      setMsg("");
    }catch(e){setErr(e.message)}setLd(false)};

  const sorted=[...hl].sort((a,b)=>sort==="rank"?a.rank-b.rank:sort==="risk"?b.rs-a.rs:b.pct-a.pct).filter(h=>filt==="ALL"||h.lb===filt);
  const labels=["ALL",...new Set(hl.map(h=>h.lb))];

  return <div style={{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"'JetBrains Mono','Fira Code',monospace"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes glow{0%,100%{box-shadow:0 0 8px ${C.gG}}50%{box-shadow:0 0 20px ${C.gG}}}
      ::selection{background:${C.g}25;color:${C.g}}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.bd};border-radius:3px}input::placeholder{color:${C.tM}}a{text-decoration:none}`}</style>

    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:90,background:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,255,136,0.005) 3px,rgba(0,255,136,0.005) 4px)"}}/>

    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 24px",borderBottom:`1px solid ${C.bd}`,background:`${C.bgS}dd`,backdropFilter:"blur(10px)",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:3,height:26,background:C.g,borderRadius:1,boxShadow:`0 0 10px ${C.gG}`,animation:"glow 3s ease infinite"}}/>
        <div><div style={{fontSize:17,fontWeight:800,letterSpacing:7}}>SIGNAL</div><div style={{fontSize:8,letterSpacing:3,color:C.g,marginTop:-2}}>WALLET DISCOVERY ENGINE</div></div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:C.tS,letterSpacing:2}}>HELIUS</a>
        <a href="https://birdeye.so" target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:C.tS,letterSpacing:2}}>BIRDEYE</a>
        <Dot/>
      </div>
    </header>

    <main style={{maxWidth:1400,margin:"0 auto",padding:"18px 24px"}}>
      <div style={{display:"flex",gap:3,marginBottom:22}}>
        {[{id:"discover",l:"DISCOVER",s:"Token → Wallets"},{id:"validate",l:"VALIDATE",s:"Wallet → Deep State"},{id:"watchlist",l:"WATCHLIST",s:`${wl.length} saved`}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 26px",background:tab===t.id?C.bgH:"transparent",border:`1px solid ${tab===t.id?C.g:C.bd}`,borderRadius:5,cursor:"pointer",textAlign:"center",fontFamily:"inherit"}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:tab===t.id?C.g:C.tS}}>{t.l}</div>
            <div style={{fontSize:8,color:tab===t.id?C.gM:C.tM,marginTop:1,letterSpacing:1}}>{t.s}</div>
          </button>)}
      </div>

      {tab==="discover"&&<div style={{animation:"fadeIn 0.25s ease"}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:3}}>DISCOVER WALLETS</div>
        <div style={{fontSize:10.5,color:C.tS,marginBottom:14}}>Token CA → holders → analyze → rank → filter → rug DNA</div>
        <div style={{display:"flex",gap:8,marginBottom:18}}>
          <input value={ca} onChange={e=>setCa(e.target.value)} onKeyDown={e=>e.key==="Enter"&&discover()} placeholder="Paste Solana token mint address..."
            style={{flex:1,padding:"11px 14px",background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,color:C.t,fontFamily:"inherit",fontSize:12,outline:"none"}}
            onFocus={e=>e.target.style.borderColor=C.g} onBlur={e=>e.target.style.borderColor=C.bd}/>
          <button onClick={discover} disabled={ld} style={{padding:"11px 26px",background:"transparent",border:`1px solid ${C.g}`,borderRadius:5,color:C.g,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:ld?"wait":"pointer",letterSpacing:2,minWidth:160}}>
            {ld?"SCANNING...":"FIND WALLETS"}</button>
        </div>
        {err&&<div style={{color:C.r,fontSize:11,marginBottom:12,padding:"8px 12px",background:C.rD,borderRadius:4,border:`1px solid ${C.r}30`}}>{err}</div>}
        {ld&&<Loader text={msg||"SCANNING..."}/>}
        {!ld&&hl.length>0&&<div style={{animation:"fadeIn 0.4s ease"}}>
          <TH m={tm}/>
          <RDP rd={rd}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,padding:"6px 0",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <span style={{fontSize:9,color:C.tM,letterSpacing:2,marginRight:6}}>SORT</span>
              {[["rank","RANK"],["risk","RISK↓"],["pct","HOLD%↓"]].map(([k,l])=>
                <button key={k} onClick={()=>setSort(k)} style={{padding:"2px 8px",fontSize:9,fontFamily:"inherit",background:sort===k?C.gD:"transparent",border:`1px solid ${sort===k?C.g:C.bd}`,color:sort===k?C.g:C.tS,borderRadius:3,cursor:"pointer"}}>{l}</button>)}
            </div>
            <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:9,color:C.tM,letterSpacing:2,marginRight:6}}>FILTER</span>
              {labels.map(l=><button key={l} onClick={()=>setFilt(l)} style={{padding:"2px 7px",fontSize:8,fontFamily:"inherit",background:filt===l?C.cD:"transparent",border:`1px solid ${filt===l?C.c:C.bd}`,color:filt===l?C.c:C.tS,borderRadius:3,cursor:"pointer"}}>{l}</button>)}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"36px 1.8fr 0.7fr 0.6fr 0.6fr 50px",padding:"6px 12px",gap:6,fontSize:8,color:C.tM,letterSpacing:1.2,borderBottom:`1px solid ${C.bd}`,marginBottom:3}}>
            <span>#</span><span>WALLET</span><span style={{textAlign:"right"}}>HOLD%</span><span style={{textAlign:"right"}}>RISK</span><span style={{textAlign:"right"}}>AMOUNT</span><span></span>
          </div>
          {sorted.map(h=><WRow key={h.tAcc} h={h} sym={tm?.symbol||""} exp={exp===h.owner} onTog={()=>toggle(h.owner)} onW={w=>{if(!wl.find(x=>x.owner===w.owner))setWl([...wl,w])}}/>)}
          <div style={{textAlign:"center",padding:14,fontSize:9,color:C.tM,letterSpacing:2}}>{sorted.length} WALLETS • {hl.filter(h=>h.rs>50).length} FLAGGED • LIVE VIA HELIUS + BIRDEYE</div>
        </div>}
        {!ld&&!hl.length&&!err&&<div style={{textAlign:"center",padding:70}}>
          <div style={{fontSize:36,marginBottom:14,opacity:.2}}>⚡</div>
          <div style={{fontSize:11,color:C.tS,letterSpacing:2}}>PASTE A TOKEN MINT TO BEGIN</div>
          <div style={{fontSize:9.5,color:C.tM,marginTop:6}}>Solana SPL tokens • Live data via Helius + Birdeye</div>
        </div>}
      </div>}

      {tab==="validate"&&<div style={{animation:"fadeIn 0.25s ease"}}><VTab/></div>}
      {tab==="watchlist"&&<div style={{animation:"fadeIn 0.25s ease"}}><WL wl={wl} onRm={i=>setWl(wl.filter((_,x)=>x!==i))}/></div>}
    </main>

    <footer style={{padding:"14px 24px",borderTop:`1px solid ${C.bd}`,display:"flex",justifyContent:"space-between",marginTop:30}}>
      <span style={{fontSize:9,color:C.tM,letterSpacing:2}}>SIGNAL v3.0 — LIVE INTELLIGENCE</span>
      <span style={{fontSize:9,color:C.tM}}>Helius RPC + Birdeye • Solana Mainnet</span>
    </footer>
  </div>;
}
