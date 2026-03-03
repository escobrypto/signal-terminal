import { useState, useEffect, useMemo, useCallback, useRef } from "react";
const HK="efb053d6-f7c7-4c90-9bc5-0ce3af9c59df";
const BK="94ba9de0953642878038f5a7eccc1114";
const HRPC=`https://mainnet.helius-rpc.com/?api-key=${HK}`;
const HAPI="https://api.helius.xyz/v0";
const BIRD="https://public-api.birdeye.so";
const bH={accept:"application/json","x-chain":"solana","X-API-KEY":BK};
const T={bg:"#060709",bg1:"#0a0b0f",bg2:"#0e0f14",s:"#1a1b24",sH:"#1f2030",brd:"#1a1b28",tx:"#c8cce0",txS:"#7d82a0",txM:"#484c68",txG:"#2e3148",g:"#10b981",gBg:"#10b98108",gBrd:"#10b98118",r:"#ef4444",rBg:"#ef444408",a:"#f59e0b",b:"#3b82f6",p:"#8b5cf6",w:"#eaecff",mono:"'Geist Mono','JetBrains Mono',monospace",sans:"'Geist','DM Sans',-apple-system,sans-serif"};
const short=(a,n=4)=>a?`${a.slice(0,n)}...${a.slice(-n)}`:"--";
const fmt=n=>{if(!n&&n!==0)return"--";if(Math.abs(n)>=1e9)return`$${(n/1e9).toFixed(1)}B`;if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(1)}K`;return`$${n.toFixed(0)}`};
const fmtAge=ts=>{if(!ts)return"--";const s=Math.floor((Date.now()-ts)/1000);if(s<60)return`${s}s`;const m=Math.floor(s/60);if(m<60)return`${m}m`;const h=Math.floor(m/60);if(h<24)return`${h}h`;return`${Math.floor(h/24)}d`};
const fmtDur=ms=>{if(!ms)return"--";const s=ms/1000;if(s<60)return`${s.toFixed(0)}s`;const m=s/60;if(m<60)return`${m.toFixed(0)}m`;const h=m/60;if(h<24)return`${h.toFixed(1)}h`;return`${(h/24).toFixed(1)}d`};
const cp=t=>navigator.clipboard.writeText(t);
const wait=ms=>new Promise(r=>setTimeout(r,ms));

// === PERSISTENT STORAGE ===
const DB={
  async get(key){try{const r=await window.storage.get(key);return r?JSON.parse(r.value):null}catch{return null}},
  async set(key,val){try{await window.storage.set(key,JSON.stringify(val));return true}catch{return false}},
  async del(key){try{await window.storage.delete(key);return true}catch{return false}},
  async list(prefix){try{const r=await window.storage.list(prefix);return r?.keys||[]}catch{return[]}},
};
// Storage keys
const SK={
  wallets:"signal:wallets",
  scanHistory:"signal:scans",
  filterPresets:"signal:filters",
  settings:"signal:settings",
};


// === API ===
async function hRpc(m,p){try{const r=await fetch(HRPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});const d=await r.json();return d.result||null}catch{return null}}
async function hSwaps(a,l=80){try{const r=await fetch(`${HAPI}/addresses/${a}/transactions?api-key=${HK}&limit=${l}&type=SWAP`);return r.ok?await r.json():[]}catch{return[]}}
async function birdOver(a){try{const r=await fetch(`${BIRD}/defi/token_overview?address=${a}`,{headers:bH});const d=await r.json();return d.data||null}catch{return null}}
async function birdSec(a){try{const r=await fetch(`${BIRD}/defi/token_security?address=${a}`,{headers:bH});const d=await r.json();return d.data||null}catch{return null}}
async function birdPort(w){try{const r=await fetch(`${BIRD}/v1/wallet/token_list?wallet=${w}`,{headers:bH});const d=await r.json();return d.data?.items||[]}catch{return[]}}
async function getHolders(m){const r=await hRpc("getTokenLargestAccounts",[m]);return r?.value||[]}
async function getAccInfo(k){const r=await hRpc("getAccountInfo",[k,{encoding:"jsonParsed"}]);return r?.value||null}


// === PARSE SWAPS ===
function parseSwaps(txns){
  const out=[];for(const tx of txns){if(tx.type!=="SWAP")continue;const time=tx.timestamp?tx.timestamp*1000:Date.now();let action="SWAP",mint="",solAmt=0;const tOut=tx.events?.swap?.tokenOutputs?.[0],tIn=tx.events?.swap?.tokenInputs?.[0],nIn=tx.events?.swap?.nativeInput,nOut=tx.events?.swap?.nativeOutput;if(tOut?.mint&&tOut.mint!=="So11111111111111111111111111111111"){action="BUY";mint=tOut.mint}else if(tIn?.mint&&tIn.mint!=="So11111111111111111111111111111111"){action="SELL";mint=tIn.mint}if(nIn?.amount)solAmt=nIn.amount/1e9;if(nOut?.amount&&action==="SELL")solAmt=nOut.amount/1e9;if(mint)out.push({action,mint,solAmt,time,sig:tx.signature||"",src:tx.source||""})}return out}

// === DEEP ANALYZE ===
function deepAnalyze(swaps){
  const tokens={};for(const s of swaps){if(!tokens[s.mint])tokens[s.mint]={buys:[],sells:[],totalBuy:0,totalSell:0,firstBuy:Infinity,lastSell:0};const tk=tokens[s.mint];if(s.action==="BUY"){tk.buys.push(s);tk.totalBuy+=s.solAmt;tk.firstBuy=Math.min(tk.firstBuy,s.time)}else{tk.sells.push(s);tk.totalSell+=s.solAmt;tk.lastSell=Math.max(tk.lastSell,s.time)}}
  let wins=0,losses=0,totalPnl=0;const tStats=[];let totalHold=0,holdN=0,scaleIns=0,partials=0,instaDumps=0;
  for(const[mint,d]of Object.entries(tokens)){const pnl=d.totalSell-d.totalBuy;const roi=d.totalBuy>0?((d.totalSell-d.totalBuy)/d.totalBuy*100):0;const closed=d.sells.length>0;if(closed){if(pnl>0)wins++;else losses++}totalPnl+=pnl;const hold=closed&&d.firstBuy<Infinity?(d.lastSell-d.firstBuy):0;if(hold>0){totalHold+=hold;holdN++}if(d.buys.length>=2)scaleIns++;if(d.sells.length>=2)partials++;const isDump=closed&&hold<30000;if(isDump)instaDumps++;let beh="HOLD";if(isDump)beh="INSTA-DUMP";else if(hold>0&&hold<300000)beh="FLIP";else if(hold>=300000&&hold<3600000)beh="SWING";tStats.push({mint,buys:d.buys.length,sells:d.sells.length,totalBuy:d.totalBuy,totalSell:d.totalSell,pnl,roi,closed,hold,beh,scaleIn:d.buys.length>=2})}
  tStats.sort((a,b)=>b.pnl-a.pnl);const cl=wins+losses;const wr=cl>0?(wins/cl*100):0;const avgHold=holdN>0?totalHold/holdN:0;const uTok=Object.keys(tokens).length;
  const dumpPct=uTok>0?(instaDumps/uTok*100):0;const scalePct=uTok>0?(scaleIns/uTok*100):0;const partPct=uTok>0?(partials/uTok*100):0;
  let style="ACTIVE TRADER";if(dumpPct>60)style="BOT/SNIPER";else if(avgHold<60000)style="FLIPPER";else if(avgHold<600000)style="SWING TRADER";else if(scalePct>40&&partPct>30)style="SMART MONEY";else if(avgHold>3600000)style="DIAMOND HANDS";
  const isBot=swaps.length>150||dumpPct>70||(uTok>0&&swaps.length/uTok>10);
  const avgSize=swaps.length>0?swaps.reduce((s,x)=>s+x.solAmt,0)/swaps.length:0;
  const isSpam=avgSize<0.01&&swaps.length>20;
  return{wins,losses,closed:cl,winRate:wr,totalPnl,tStats,totalTrades:swaps.length,uniqueTokens:uTok,avgHold,dumpPct,scalePct,partPct,style,isBot:isBot||isSpam,avgSize}}

// === RUG DNA ===
async function rugDNA(mint){
  const flags=[];let score=0;
  const sec=await birdSec(mint);
  if(sec){if(sec.mintAuthority){flags.push("MINT AUTHORITY ACTIVE");score+=30}if(sec.freezeAuthority){flags.push("FREEZE AUTHORITY");score+=25}if(sec.top10HolderPercent>0.5){flags.push("TOP 10 HOLD "+(sec.top10HolderPercent*100).toFixed(0)+"%");score+=20}if(sec.creatorPercentage>0.1){flags.push("CREATOR "+(sec.creatorPercentage*100).toFixed(1)+"%");score+=15}}
  const holders=await getHolders(mint);
  if(holders.length>0){const amts=holders.slice(0,20).map(h=>parseFloat(h.uiAmount||0)).filter(a=>a>0);let clusters=0;for(let i=0;i<amts.length;i++)for(let j=i+1;j<amts.length;j++)if(amts[i]>0&&Math.abs(amts[i]-amts[j])/Math.max(amts[i],amts[j])<0.05)clusters++;if(clusters>=3){flags.push(clusters+" BUNDLED PAIRS");score+=25}else if(clusters>=1){flags.push(clusters+" similar holdings");score+=10}}
  const info=await birdOver(mint);let liqR=0;
  if(info){const mc=info.mc||info.marketCap||0;const liq=info.liquidity||0;if(mc>0&&liq>0)liqR=liq/mc;if(liqR<0.03&&mc>50000){flags.push("LOW LIQ RATIO "+(liqR*100).toFixed(1)+"%");score+=15}if(info.holder&&info.holder<50){flags.push("ONLY "+info.holder+" HOLDERS");score+=10}}
  let risk="LOW";if(score>=60)risk="CRITICAL";else if(score>=40)risk="HIGH";else if(score>=20)risk="MEDIUM";else if(score>=10)risk="WATCH";
  return{flags,score,risk,info}}

// === UI ATOMS ===
const Badge=({children,color=T.g})=><span style={{fontSize:8,padding:"2px 6px",borderRadius:2,background:`${color}0d`,color,fontFamily:T.mono,fontWeight:700,letterSpacing:.5,border:`1px solid ${color}15`}}>{children}</span>;
const ActionTag=({action})=><span style={{fontSize:10,fontWeight:800,color:action==="BUY"?T.g:action==="SELL"?T.r:T.txM,fontFamily:T.mono}}>{action}</span>;
const CopyBtn=({text,label="COPY"})=>{const[ok,setOk]=useState(false);return<button onClick={e=>{e.stopPropagation();cp(text);setOk(true);setTimeout(()=>setOk(false),1200)}} style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${ok?T.g+"30":T.brd}`,background:ok?T.gBg:"transparent",color:ok?T.g:T.txM,fontSize:8,fontWeight:700,fontFamily:T.mono,cursor:"pointer"}}>{ok?"\u2713":label}</button>};
const AxiomBtn=({mint})=><a href={`https://axiom.trade/t/${mint}/`} target="_blank" rel="noopener noreferrer" style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${T.g}20`,background:T.gBg,color:T.g,fontSize:8,fontWeight:700,fontFamily:T.mono,textDecoration:"none"}}>AXIOM</a>;
const GmgnBtn=({addr})=><a href={`https://gmgn.ai/sol/address/${addr}`} target="_blank" rel="noopener noreferrer" style={{padding:"3px 8px",borderRadius:3,border:`1px solid ${T.p}20`,background:`${T.p}08`,color:T.p,fontSize:8,fontWeight:700,fontFamily:T.mono,textDecoration:"none"}}>GMGN</a>;
const Stat=({label,value,color,sub})=><div><div style={{fontSize:8,color:T.txM,letterSpacing:1,fontWeight:600,fontFamily:T.mono,textTransform:"uppercase",marginBottom:3}}>{label}</div><div style={{fontSize:14,fontWeight:700,fontFamily:T.mono,color:color||T.w,lineHeight:1}}>{value}</div>{sub&&<div style={{fontSize:8,color:T.txG,fontFamily:T.mono,marginTop:2}}>{sub}</div>}</div>;
const Section=({children,sub,right})=><div style={{marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}><div><div style={{fontSize:10,fontWeight:700,letterSpacing:2.5,color:T.txM,fontFamily:T.mono,textTransform:"uppercase",paddingBottom:6,borderBottom:`1px solid ${T.brd}`}}>{children}</div>{sub&&<div style={{fontSize:9,color:T.txG,fontFamily:T.mono,marginTop:4}}>{sub}</div>}</div>{right&&<div>{right}</div>}</div>;
const Input=({value,onChange,placeholder,onSubmit})=><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onKeyDown={e=>e.key==="Enter"&&onSubmit?.()} style={{flex:1,padding:"8px 12px",borderRadius:4,background:T.bg2,border:`1px solid ${T.brd}`,color:T.tx,fontSize:11,fontFamily:T.mono,outline:"none"}} onFocus={e=>e.target.style.borderColor=T.g+"40"} onBlur={e=>e.target.style.borderColor=T.brd}/>;
const Btn=({onClick,disabled,children,color=T.g})=><button onClick={onClick} disabled={disabled} style={{padding:"8px 18px",borderRadius:4,background:disabled?T.bg2:`${color}08`,border:`1px solid ${disabled?T.brd:color+"25"}`,color:disabled?T.txM:color,fontSize:9,fontWeight:700,letterSpacing:1,fontFamily:T.mono,cursor:disabled?"default":"pointer"}}>{children}</button>;
const WinRateBar=({rate,w=60})=>{const c=rate>=60?T.g:rate>=45?T.a:T.r;return<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:w,height:4,borderRadius:2,background:T.bg,overflow:"hidden"}}><div style={{width:`${Math.min(rate,100)}%`,height:"100%",borderRadius:2,background:c,opacity:.7}}/></div><span style={{fontSize:11,fontWeight:700,color:c,fontFamily:T.mono}}>{rate.toFixed(0)}%</span></div>};
const StyleBadge=({sty,isBot})=>{if(isBot)return<Badge color={T.r}>BOT</Badge>;const c={"SMART MONEY":T.g,"DIAMOND HANDS":T.g,"SWING TRADER":T.b,"ACTIVE TRADER":T.b,FLIPPER:T.a,"BOT/SNIPER":T.r};return<Badge color={c[sty]||T.txM}>{sty}</Badge>};
const BBar=({label,pct,color})=><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:7,color:T.txM,fontFamily:T.mono,width:55,textAlign:"right"}}>{label}</span><div style={{width:40,height:3,borderRadius:1,background:T.bg,overflow:"hidden"}}><div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:color,opacity:.6}}/></div><span style={{fontSize:7,color:T.txS,fontFamily:T.mono}}>{pct.toFixed(0)}%</span></div>;
const RiskBadge=({risk})=>{const c={CRITICAL:T.r,HIGH:T.r,MEDIUM:T.a,WATCH:T.a,LOW:T.g};return<Badge color={c[risk]||T.txM}>{risk} RISK</Badge>};
const SaveIndicator=({saved})=><span style={{fontSize:8,color:saved?T.g:T.txG,fontFamily:T.mono}}>{saved?"\u2713 SAVED":"..."}</span>;

// === WALLET CARD ===
const WalletCard=({r,i,onAdd,expanded,onToggle,tracked})=>(
  <div style={{borderRadius:6,border:`1px solid ${r.isBot?T.r+"15":r.winRate>=60?T.g+"15":T.brd}`,marginBottom:6,background:r.isBot?T.rBg:r.winRate>=60?T.gBg:"transparent",opacity:r.isBot?.45:1}}>
    <div onClick={onToggle} style={{padding:"12px 14px",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background=T.sH} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {i!=null&&<span style={{fontSize:11,fontWeight:700,color:T.w,fontFamily:T.mono}}>#{i+1}</span>}
          <span style={{fontSize:11,color:T.b,fontFamily:T.mono,cursor:"pointer"}} onClick={e=>{e.stopPropagation();cp(r.addr)}}>{short(r.addr,6)}</span>
          <WinRateBar rate={r.winRate}/>
          <StyleBadge sty={r.style} isBot={r.isBot}/>
          {r.avgSize>0&&<span style={{fontSize:8,color:T.txG,fontFamily:T.mono}}>avg {r.avgSize.toFixed(2)} SOL</span>}
        </div>
        <div style={{display:"flex",gap:4}}>
          <CopyBtn text={r.addr} label="WALLET"/>
          <GmgnBtn addr={r.addr}/>
          {onAdd&&!r.isBot&&!tracked&&<button onClick={e=>{e.stopPropagation();onAdd(r.addr,i!=null?`D-${i+1}`:`V-${Date.now()%999}`,r.winRate,r.style)}} style={{padding:"3px 10px",borderRadius:3,border:`1px solid ${T.g}25`,background:T.gBg,color:T.g,fontSize:8,fontWeight:700,fontFamily:T.mono,cursor:"pointer"}}>+ TRACK</button>}
          {tracked&&<Badge color={T.g}>TRACKED</Badge>}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:10}}>
        <Stat label="Win Rate" value={`${r.winRate.toFixed(0)}%`} color={r.winRate>=60?T.g:r.winRate>=45?T.a:T.r}/>
        <Stat label="W / L" value={`${r.wins}/${r.losses}`}/>
        <Stat label="Trades" value={r.totalTrades}/>
        <Stat label="Tokens" value={r.uniqueTokens}/>
        <Stat label="PNL (SOL)" value={`${r.totalPnl>=0?"+":""}${r.totalPnl.toFixed(2)}`} color={r.totalPnl>=0?T.g:T.r}/>
        <Stat label="Avg Hold" value={fmtDur(r.avgHold)} sub={r.avgHold<60000?"fast":r.avgHold<600000?"mid":"slow"}/>
        <div><BBar label="Scale-in" pct={r.scalePct} color={T.g}/><BBar label="Partials" pct={r.partPct} color={T.b}/><BBar label="Dump" pct={r.dumpPct} color={T.r}/></div>
        <Stat label="Best" value={r.tStats[0]?`+${r.tStats[0].pnl.toFixed(1)}`:"--"} color={T.g} sub="SOL"/>
      </div>
    </div>
    {expanded&&<div style={{padding:"0 14px 14px",borderTop:`1px solid ${T.brd}`}}>
      <div style={{fontSize:8,color:T.txM,fontFamily:T.mono,letterSpacing:1,marginTop:10,marginBottom:6}}>TOKEN P&L + BEHAVIOR</div>
      {r.tStats.slice(0,12).map((ts,j)=><div key={j} style={{display:"grid",gridTemplateColumns:"90px 50px 50px 60px 60px 55px 65px 50px 60px",gap:4,fontSize:10,fontFamily:T.mono,padding:"4px 6px",borderRadius:2,background:j%2===0?"transparent":T.bg2+"30",alignItems:"center"}}>
        <span style={{color:T.txS,cursor:"pointer"}} onClick={()=>cp(ts.mint)}>{short(ts.mint)}</span>
        <span style={{color:T.txM}}>{ts.buys}B/{ts.sells}S</span>
        <span style={{color:T.txM}}>In:{ts.totalBuy.toFixed(1)}</span>
        <span style={{color:T.txM}}>Out:{ts.totalSell.toFixed(1)}</span>
        <span style={{color:ts.pnl>=0?T.g:T.r,fontWeight:700}}>{ts.pnl>=0?"+":""}{ts.pnl.toFixed(2)}</span>
        <span style={{color:ts.roi>=0?T.g:T.r,fontSize:9}}>{ts.closed?`${ts.roi>=0?"+":""}${ts.roi.toFixed(0)}%`:"OPEN"}</span>
        <Badge color={ts.beh==="INSTA-DUMP"?T.r:ts.beh==="FLIP"?T.a:ts.beh==="HOLD"?T.g:T.b}>{ts.beh}</Badge>
        <span style={{color:T.txG,fontSize:9}}>{fmtDur(ts.hold)}</span>
        <div style={{display:"flex",gap:2}}><CopyBtn text={ts.mint} label="CA"/><AxiomBtn mint={ts.mint}/></div>
      </div>)}
    </div>}
  </div>
);

// === DISCOVER ===
const Discover=({onAdd,wallets})=>{
  const[mint,setMint]=useState("");const[loading,setLoading]=useState(false);const[status,setStatus]=useState("");const[results,setResults]=useState([]);const[tokenInfo,setTokenInfo]=useState(null);const[expanded,setExpanded]=useState(null);const[clusters,setClusters]=useState([]);const[rug,setRug]=useState(null);const[history,setHistory]=useState([]);
  useEffect(()=>{(async()=>{const h=await DB.get(SK.scanHistory);if(h)setHistory(h)})()},[]);
  const rc=r=>({"CRITICAL":T.r,"HIGH":T.r,"MEDIUM":T.a,"WATCH":T.a,"LOW":T.g})[r]||T.txM;
  const discover=async()=>{if(!mint.trim())return;setLoading(true);setResults([]);setTokenInfo(null);setClusters([]);setRug(null);const addr=mint.trim();
    setStatus("Token info + rug check...");
    const[infoR,rugR]=await Promise.allSettled([birdOver(addr),rugDNA(addr)]);
    const info=infoR.status==="fulfilled"?infoR.value:null;setTokenInfo(info);
    const rugData=rugR.status==="fulfilled"?rugR.value:null;setRug(rugData);
    setStatus("Finding holders...");const holders=await getHolders(addr);
    if(!holders.length){setStatus("No holders found.");setLoading(false);return}
    setStatus("Resolving wallets...");const wals=[];
    const rr=await Promise.allSettled(holders.slice(0,20).map(h=>getAccInfo(h.address)));
    rr.forEach(r=>{if(r.status==="fulfilled"&&r.value){const o=r.value?.data?.parsed?.info?.owner;if(o&&!wals.includes(o))wals.push(o)}});
    if(!wals.length){setStatus("Could not resolve.");setLoading(false);return}
    setStatus("Analyzing "+wals.length+" wallets...");
    const ar=await Promise.allSettled(wals.slice(0,15).map(async w=>{const txns=await hSwaps(w,80);const parsed=parseSwaps(txns);if(parsed.length<3)return null;return{addr:w,...deepAnalyze(parsed)}}));
    const analyzed=ar.map(r=>r.status==="fulfilled"?r.value:null).filter(Boolean);
    analyzed.sort((a,b)=>{if(a.isBot&&!b.isBot)return 1;if(!a.isBot&&b.isBot)return-1;const bb=s=>s==="SMART MONEY"?2:s==="SWING TRADER"?1.5:s==="DIAMOND HANDS"?1.3:s==="FLIPPER"?.8:1;return(b.winRate*Math.log2(Math.max(b.closed,1))*(b.totalPnl>0?1.5:.5)*bb(b.style))-(a.winRate*Math.log2(Math.max(a.closed,1))*(a.totalPnl>0?1.5:.5)*bb(a.style))});
    const wtm={};for(const w of analyzed){if(!w.isBot)wtm[w.addr]=new Set(w.tStats.map(t=>t.mint))}
    const cP=[];const addrs=Object.keys(wtm);
    for(let i=0;i<addrs.length;i++)for(let j=i+1;j<addrs.length;j++){const shared=[...wtm[addrs[i]]].filter(m=>wtm[addrs[j]].has(m)&&m!==addr);if(shared.length>=2)cP.push({w1:addrs[i],w2:addrs[j],n:shared.length})}
    cP.sort((a,b)=>b.n-a.n);setClusters(cP);setResults(analyzed);
    const scan={mint:addr,symbol:info?.symbol||"?",mc:info?.mc||0,time:Date.now(),walletCount:analyzed.length,goodCount:analyzed.filter(w=>!w.isBot&&w.winRate>=50).length,risk:rugData?.risk||"?"};
    const newHist=[scan,...history.filter(h=>h.mint!==addr)].slice(0,30);setHistory(newHist);
    await DB.set(SK.scanHistory,newHist);
    setStatus("Done. "+analyzed.length+" wallets. "+scan.goodCount+" copyable.");setLoading(false)};
  return(<div>
    <Section sub="Token CA > holders > analyze > rank > filter bots > clusters > rug DNA">DISCOVER WALLETS</Section>
    <div style={{display:"flex",gap:8,marginBottom:16}}><Input value={mint} onChange={setMint} placeholder="Paste token CA..." onSubmit={discover}/><Btn onClick={discover} disabled={loading}>{loading?"SCANNING...":"FIND WALLETS"}</Btn></div>
    {status&&<div style={{fontSize:10,color:loading?T.b:T.g,fontFamily:T.mono,marginBottom:12,padding:"6px 10px",borderRadius:4,background:T.bg2}}>{status}</div>}
    {!loading&&!results.length&&history.length>0&&<div style={{marginBottom:16}}>
      <div style={{fontSize:9,color:T.txM,fontFamily:T.mono,letterSpacing:2,fontWeight:700,marginBottom:8}}>RECENT SCANS (saved)</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {history.slice(0,10).map((h,hi)=><button key={hi} onClick={()=>setMint(h.mint)} style={{padding:"6px 12px",borderRadius:4,background:T.bg2,border:"1px solid "+T.brd,cursor:"pointer",fontSize:10,fontFamily:T.mono,color:T.txS,display:"flex",alignItems:"center",gap:6}}>
          <span style={{color:T.b,fontWeight:600}}>${h.symbol}</span>
          <span style={{color:T.txG}}>{fmt(h.mc)}</span>
          <RiskBadge risk={h.risk}/>
          <span style={{color:T.txG}}>{h.goodCount}/{h.walletCount}</span>
          <span style={{color:T.txG,fontSize:8}}>{fmtAge(h.time)}</span>
        </button>)}
      </div>
    </div>}
    {tokenInfo&&<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,padding:"12px 16px",background:T.bg2,borderRadius:6,border:"1px solid "+T.brd,marginBottom:12}}>
      <Stat label="Token" value={tokenInfo.symbol?"$"+tokenInfo.symbol:"?"}/><Stat label="MC" value={fmt(tokenInfo.mc||tokenInfo.marketCap||0)}/><Stat label="Liq" value={fmt(tokenInfo.liquidity||0)}/><Stat label="Holders" value={(tokenInfo.holder||0).toLocaleString()}/><Stat label="24h Vol" value={fmt(tokenInfo.v24hUSD||0)}/>
    </div>}
    {rug&&<div style={{padding:"10px 14px",borderRadius:6,marginBottom:12,background:rc(rug.risk)+"08",border:"1px solid "+rc(rug.risk)+"18"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:rug.flags.length?8:0}}><span style={{fontSize:9,fontWeight:700,letterSpacing:2,color:T.txM,fontFamily:T.mono}}>RUG DNA</span><RiskBadge risk={rug.risk}/><span style={{fontSize:9,color:T.txM,fontFamily:T.mono}}>Score: {rug.score}/100</span></div>
      {rug.flags.map((f,fi)=><div key={fi} style={{fontSize:10,color:T.txS,fontFamily:T.mono,padding:"2px 0"}}>{f}</div>)}
      {!rug.flags.length&&<span style={{fontSize:10,color:T.g,fontFamily:T.mono}}>No red flags</span>}
    </div>}
    {clusters.length>0&&<div style={{marginBottom:12,padding:"10px 14px",borderRadius:6,background:T.a+"08",border:"1px solid "+T.a+"15"}}>
      <div style={{fontSize:9,fontWeight:700,letterSpacing:2,color:T.a,fontFamily:T.mono,marginBottom:6}}>CLUSTERS</div>
      {clusters.slice(0,5).map((c,ci)=><div key={ci} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 6px",fontSize:10,fontFamily:T.mono}}>
        <span style={{color:T.b,cursor:"pointer"}} onClick={()=>cp(c.w1)}>{short(c.w1)}</span><span style={{color:T.txM}}>+</span>
        <span style={{color:T.b,cursor:"pointer"}} onClick={()=>cp(c.w2)}>{short(c.w2)}</span><Badge color={T.a}>{c.n} shared</Badge>
      </div>)}
    </div>}
    {results.map((r,i)=><WalletCard key={r.addr} r={r} i={i} onAdd={onAdd} expanded={expanded===r.addr} onToggle={()=>setExpanded(expanded===r.addr?null:r.addr)} tracked={wallets.some(w=>w.addr===r.addr)}/>)}
  </div>)};

// === VALIDATE ===
const Validate=({onAdd,wallets})=>{
  const[addr,setAddr]=useState("");const[loading,setLoading]=useState(false);const[result,setResult]=useState(null);const[holdings,setHoldings]=useState(null);const[expanded,setExpanded]=useState(false);
  const validate=async()=>{if(!addr.trim())return;setLoading(true);setResult(null);setHoldings(null);const w=addr.trim();
    const[swapR,portR]=await Promise.allSettled([hSwaps(w,100),birdPort(w)]);
    const swaps=swapR.status==="fulfilled"?parseSwaps(swapR.value):[];
    setResult({addr:w,...deepAnalyze(swaps)});
    const port=portR.status==="fulfilled"?portR.value:[];
    const hold=port.filter(t=>t.uiAmount>0&&t.symbol!=="SOL").sort((a,b)=>(b.valueUsd||0)-(a.valueUsd||0));
    const sol=port.find(t=>t.symbol==="SOL");
    setHoldings({tokens:hold.slice(0,20),sol:sol?.uiAmount||0,totalVal:hold.reduce((s,t)=>s+(t.valueUsd||0),0)});setLoading(false)};
  return(<div>
    <Section sub="Paste wallet - full analysis with win rate, hold behavior, bot detection, PNL">VALIDATE WALLET</Section>
    <div style={{display:"flex",gap:8,marginBottom:16}}><Input value={addr} onChange={setAddr} placeholder="Paste wallet address..." onSubmit={validate}/><Btn onClick={validate} disabled={loading}>{loading?"ANALYZING...":"VALIDATE"}</Btn></div>
    {result&&<div>
      <WalletCard r={result} onAdd={onAdd} expanded={expanded} onToggle={()=>setExpanded(!expanded)} tracked={wallets.some(w=>w.addr===result.addr)}/>
      {holdings&&<div style={{marginTop:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{fontSize:9,color:T.b,fontFamily:T.mono,letterSpacing:2,fontWeight:700}}>HOLDINGS</span><span style={{fontSize:9,color:T.txM,fontFamily:T.mono}}>{holdings.sol.toFixed(2)} SOL | {fmt(holdings.totalVal)}</span></div>
        {holdings.tokens.map((tk,j)=><div key={j} style={{display:"grid",gridTemplateColumns:"80px 1fr 70px 60px 80px",alignItems:"center",gap:6,padding:"5px 8px",borderRadius:3,background:j%2===0?"transparent":T.bg2+"30",fontSize:10,fontFamily:T.mono}}>
          <span style={{color:T.b,fontWeight:600}}>{tk.symbol||"???"}</span>
          <span style={{color:T.txG,cursor:"pointer"}} onClick={()=>cp(tk.address)}>{short(tk.address)}</span>
          <span style={{color:T.txS,textAlign:"right"}}>{tk.uiAmount>1e6?(tk.uiAmount/1e6).toFixed(1)+"M":tk.uiAmount>1e3?(tk.uiAmount/1e3).toFixed(1)+"K":tk.uiAmount?.toFixed(1)}</span>
          <span style={{color:tk.valueUsd>100?T.g:T.txM,textAlign:"right",fontWeight:600}}>{tk.valueUsd>0?fmt(tk.valueUsd):"--"}</span>
          <div style={{display:"flex",gap:3,justifyContent:"flex-end"}}><CopyBtn text={tk.address} label="CA"/><AxiomBtn mint={tk.address}/></div>
        </div>)}
      </div>}
    </div>}
    {!result&&!loading&&<div style={{padding:40,textAlign:"center",color:T.txM,fontSize:11,fontFamily:T.mono,background:T.bg2,borderRadius:6,border:"1px solid "+T.brd}}>Paste wallet. Pulls 100 swaps, deep analysis.</div>}
  </div>)};

// === WATCHLIST ===
const Watchlist=({wallets,setWallets})=>{
  const[trades,setTrades]=useState([]);const[loading,setLoading]=useState(false);const[tInfo,setTInfo]=useState({});
  const loadFeed=useCallback(async()=>{if(!wallets.length)return;setLoading(true);
    const results=await Promise.allSettled(wallets.map(async w=>{const txns=await hSwaps(w.addr,12);return parseSwaps(txns).map(s=>({...s,tag:w.tag,walletAddr:w.addr}))}));
    const all=[];results.forEach(r=>{if(r.status==="fulfilled")all.push(...r.value)});
    all.sort((a,b)=>b.time-a.time);setTrades(all.slice(0,80));setLoading(false);
    const mints=[...new Set(all.map(t=>t.mint).filter(Boolean))].slice(0,10);
    for(const m of mints){if(!tInfo[m]){const info=await birdOver(m);if(info)setTInfo(p=>({...p,[m]:info}));await wait(200)}}},[wallets]);
  useEffect(()=>{loadFeed()},[loadFeed]);
  const conv=useMemo(()=>{const map={};trades.filter(t=>t.action==="BUY").forEach(t=>{if(!map[t.mint])map[t.mint]=new Set();map[t.mint].add(t.tag)});return Object.entries(map).filter(([_,w])=>w.size>=2).map(([mint,w])=>({mint,count:w.size,names:[...w]}))},[trades]);
  return(<div>
    <Section sub={wallets.length+" wallets saved | Convergence when 2+ buy same token"} right={<SaveIndicator saved={true}/>}>WATCHLIST</Section>
    {!wallets.length&&<div style={{padding:40,textAlign:"center",color:T.txM,fontSize:11,fontFamily:T.mono,background:T.bg2,borderRadius:6,border:"1px solid "+T.brd}}>No wallets. DISCOVER or VALIDATE then + TRACK. Saved automatically.</div>}
    {wallets.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
      {wallets.map(w=><div key={w.addr} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:4,background:T.bg2,border:"1px solid "+T.brd,fontSize:9,fontFamily:T.mono}}>
        <span style={{color:T.g,fontWeight:700}}>{w.tag}</span><span style={{color:T.txM}}>{short(w.addr)}</span>
        <StyleBadge sty={w.style||"?"}/><span style={{color:w.winRate>=60?T.g:T.txM}}>{w.winRate?.toFixed(0)||"?"}%</span>
        <button onClick={()=>setWallets(p=>p.filter(x=>x.addr!==w.addr))} style={{background:"none",border:"none",color:T.r,cursor:"pointer",fontSize:10,fontFamily:T.mono}}>x</button>
      </div>)}<Btn onClick={loadFeed} disabled={loading}>{loading?"...":"REFRESH"}</Btn>
    </div>}
    {conv.length>0&&<div style={{marginBottom:16,padding:"14px 16px",borderRadius:8,background:T.gBg,border:"1px solid "+T.gBrd}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:2.5,color:T.g,fontFamily:T.mono,marginBottom:10}}>CONVERGENCE</div>
      {conv.map((c,ci)=>{const info=tInfo[c.mint];return<div key={ci} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderRadius:4,background:T.bg2,marginBottom:4}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:14,fontWeight:700,color:T.w,fontFamily:T.sans}}>{info?.symbol?"$"+info.symbol:short(c.mint,6)}</span>
          <Badge color={T.g}>{c.count} WALLETS</Badge>
          <span style={{fontSize:9,color:T.txM,fontFamily:T.mono}}>{c.names.join(" | ")}</span>
          {info?.mc&&<span style={{fontSize:9,color:T.txM,fontFamily:T.mono}}>MC {fmt(info.mc)}</span>}
        </div>
        <div style={{display:"flex",gap:4}}><CopyBtn text={c.mint} label="CA"/><AxiomBtn mint={c.mint}/></div>
      </div>})}
    </div>}
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      {trades.map((t,i)=>{const info=tInfo[t.mint];return<div key={t.sig+i} style={{display:"grid",gridTemplateColumns:"32px 80px 1fr 80px 100px",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:4,background:i%2===0?"transparent":T.bg2+"40"}} onMouseEnter={e=>e.currentTarget.style.background=T.sH} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":T.bg2+"40"}>
        <ActionTag action={t.action}/>
        <span style={{fontSize:10,fontWeight:700,color:T.g,fontFamily:T.mono}}>{t.tag}</span>
        <div><span style={{fontSize:11,fontWeight:600,color:T.w,fontFamily:T.sans}}>{info?.symbol?"$"+info.symbol:short(t.mint,5)}</span>{t.solAmt>0&&<span style={{fontSize:9,color:t.action==="BUY"?T.g:T.r,fontFamily:T.mono,marginLeft:8}}>{t.solAmt.toFixed(2)} SOL</span>}<span style={{fontSize:9,color:T.txG,fontFamily:T.mono,marginLeft:8}}>{t.src} | {fmtAge(t.time)}</span></div>
        <span style={{fontSize:9,color:T.txG,fontFamily:T.mono,textAlign:"right"}}>{short(t.mint)}</span>
        <div style={{display:"flex",gap:4,justifyContent:"flex-end"}}><CopyBtn text={t.mint} label="CA"/><AxiomBtn mint={t.mint}/></div>
      </div>})}
    </div>
  </div>)};

// === MAIN APP ===
export default function App(){
  const[tab,setTab]=useState("discover");
  const[wallets,setWallets]=useState([]);
  const[loaded,setLoaded]=useState(false);
  const[saveStatus,setSaveStatus]=useState("");
  useEffect(()=>{(async()=>{try{const saved=await DB.get(SK.wallets);if(saved&&Array.isArray(saved))setWallets(saved)}catch{}setLoaded(true)})()},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{const ok=await DB.set(SK.wallets,wallets);setSaveStatus(ok?"saved":"");if(ok)setTimeout(()=>setSaveStatus(""),2000)})()},[wallets,loaded]);
  const addW=(addr,tag,winRate,style)=>{if(wallets.find(w=>w.addr===addr))return;setWallets(p=>[...p,{addr,tag,winRate,style,addedAt:Date.now()}])};
  const fonts="@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');@font-face{font-family:'Geist Mono';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-mono/GeistMono-Regular.woff2') format('woff2');font-weight:400}@font-face{font-family:'Geist Mono';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-mono/GeistMono-Medium.woff2') format('woff2');font-weight:500}@font-face{font-family:'Geist Mono';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-mono/GeistMono-SemiBold.woff2') format('woff2');font-weight:600}@font-face{font-family:'Geist Mono';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-mono/GeistMono-Bold.woff2') format('woff2');font-weight:700}@font-face{font-family:'Geist';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-sans/Geist-Regular.woff2') format('woff2');font-weight:400}@font-face{font-family:'Geist';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-sans/Geist-Medium.woff2') format('woff2');font-weight:500}@font-face{font-family:'Geist';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-sans/Geist-SemiBold.woff2') format('woff2');font-weight:600}@font-face{font-family:'Geist';src:url('https://cdn.jsdelivr.net/npm/geist@1.2.0/dist/fonts/geist-sans/Geist-Bold.woff2') format('woff2');font-weight:700}";
  const base="*{box-sizing:border-box;margin:0;padding:0}body{background:"+T.bg+"}*::-webkit-scrollbar{width:3px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:"+T.brd+";border-radius:2px}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}";
  if(!loaded)return(<div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:T.txM,fontFamily:T.mono,fontSize:12}}>Loading saved data...</span></div>);
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.tx,fontFamily:T.sans}}>
      <style>{fonts+base}</style>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",opacity:.01,backgroundImage:"radial-gradient(circle at 1px 1px, "+T.txM+" 1px, transparent 0)",backgroundSize:"24px 24px"}}/>
      <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 24px",borderBottom:"1px solid "+T.brd,background:T.bg1,position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:4,height:22,borderRadius:1,background:T.g}}/>
          <div><div style={{fontSize:15,fontWeight:700,letterSpacing:4,color:T.w,fontFamily:T.mono}}>SIGNAL</div><div style={{fontSize:8,color:T.txM,fontFamily:T.mono,letterSpacing:2.5,marginTop:1}}>WALLET DISCOVERY ENGINE</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <Badge color={T.g}>HELIUS</Badge><Badge color={T.p}>BIRDEYE</Badge>
          {saveStatus&&<span style={{fontSize:8,color:T.g,fontFamily:T.mono}}>SAVED</span>}
          <div style={{display:"flex",alignItems:"center",gap:5,marginLeft:6}}><span style={{width:5,height:5,borderRadius:"50%",background:T.g,animation:"pulse 2.5s ease-in-out infinite"}}/><span style={{fontSize:9,color:T.g,fontFamily:T.mono,fontWeight:500}}>LIVE</span></div>
        </div>
      </header>
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"10px 24px",borderBottom:"1px solid "+T.brd}}>
        {[["discover","DISCOVER","Token > Find wallets"],["validate","VALIDATE","Wallet > Deep stats"],["watchlist","WATCHLIST",wallets.length+" saved"]].map(([id,l,d])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"8px 20px",borderRadius:5,border:"1px solid "+(tab===id?T.g+"20":T.brd),cursor:"pointer",fontSize:10,fontWeight:600,letterSpacing:1.2,fontFamily:T.mono,background:tab===id?T.gBg:"transparent",color:tab===id?T.g:T.txM}}>
            {l}<div style={{fontSize:8,color:tab===id?T.g+"80":T.txG,fontWeight:400,marginTop:2}}>{d}</div>
          </button>))}
      </div>
      <div style={{padding:"18px 24px 80px"}}>
        {tab==="discover"&&<Discover onAdd={addW} wallets={wallets}/>}
        {tab==="validate"&&<Validate onAdd={addW} wallets={wallets}/>}
        {tab==="watchlist"&&<Watchlist wallets={wallets} setWallets={setWallets}/>}
      </div>
      <div style={{position:"fixed",bottom:0,left:0,right:0,padding:"8px 24px",borderTop:"1px solid "+T.brd,background:T.bg1,display:"flex",justifyContent:"space-between",alignItems:"center",zIndex:50}}>
        <div style={{display:"flex",gap:16}}>
          {[["AXIOM","https://axiom.trade"],["GMGN","https://gmgn.ai"],["DEXSCREENER","https://dexscreener.com"]].map(([l,u])=><a key={l} href={u} target="_blank" rel="noopener noreferrer" style={{fontSize:9,fontWeight:600,letterSpacing:1.5,color:T.txM,fontFamily:T.mono,textDecoration:"none"}} onMouseEnter={e=>e.currentTarget.style.color=T.g} onMouseLeave={e=>e.currentTarget.style.color=T.txM}>{l}</a>)}
        </div>
        <span style={{fontSize:9,color:T.txG,fontFamily:T.mono}}>Data persists across sessions. Sign-in coming soon.</span>
      </div>
    </div>);}
