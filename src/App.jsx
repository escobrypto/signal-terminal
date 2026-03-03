import { useState, useCallback } from "react";

const HK="efb053d6-f7c7-4c90-9bc5-0ce3af9c59df";
const BK="94ba9de0953642878038f5a7eccc1114";
const RPC=`https://mainnet.helius-rpc.com/?api-key=${HK}`;
const HAPI=`https://api.helius.xyz/v0`;
const BAPI=`https://public-api.birdeye.so`;
const C={bg:"#05070b",bgS:"#0a0e17",bgC:"#0d1219",bgH:"#121a27",bd:"#161f30",bdH:"#1e3a2a",g:"#00ff88",gD:"#00ff8820",gM:"#00cc6a",gG:"#00ff8840",r:"#ff2e4c",rD:"#ff2e4c18",y:"#ffc800",yD:"#ffc80018",c:"#00cfff",cD:"#00cfff18",p:"#b44dff",o:"#ff8c00",t:"#dfe6f0",tS:"#5a6e8a",tM:"#2d3d56"};

// ─── API ────────────────────────────────────────────────
async function rpcCall(method,params){try{const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});return(await r.json()).result||null}catch(e){return null}}
async function bGet(ep,params={}){try{const u=new URL(`${BAPI}${ep}`);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));return await(await fetch(u,{headers:{"X-API-KEY":BK,"x-chain":"solana"}})).json()}catch(e){return null}}
async function getOverview(a){return(await bGet("/defi/token_overview",{address:a}))?.data||null}
async function getSecurity(a){return(await bGet("/defi/token_security",{address:a}))?.data||null}

async function getHolders(mint){
  const lg=await rpcCall("getTokenLargestAccounts",[mint]);
  if(!lg?.value)return[];
  const out=[];
  for(const ac of lg.value.slice(0,20)){
    try{
      const info=await rpcCall("getAccountInfo",[ac.address,{encoding:"jsonParsed"}]);
      const p=info?.value?.data?.parsed?.info;
      out.push(p?{tAcc:ac.address,owner:p.owner,amt:parseFloat(p.tokenAmount?.uiAmountString||"0")}:{tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0")});
    }catch(e){out.push({tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0")})}
  }
  return out;
}

async function getSolBal(a){const r=await rpcCall("getBalance",[a]);return r?r/1e9:0}

async function getTxs(a){
  try{return await(await fetch(`${HAPI}/addresses/${a}/transactions?api-key=${HK}&limit=15`)).json()}catch(e){return[]}
}

async function getPortfolio(a){return(await bGet("/v1/wallet/token_list",{wallet:a}))?.data?.items||[]}

// Birdeye wallet trader data — PnL, win rate etc.
async function getTraderData(wallet){
  try{
    const d=await bGet("/trader/gainers-losers",{wallet,type:"7D"});
    return d?.data||null;
  }catch(e){return null}
}

// ─── ANALYSIS: extract PnL from TX history ──────────────
function analyzeTxsForPnL(txs, tokenMint){
  let totalBought=0, totalSold=0, buyCount=0, sellCount=0, swapCount=0;
  let firstBuyTime=null, lastSellTime=null;
  const holds=[];

  for(const tx of (txs||[])){
    if(tx.type==="SWAP"){
      swapCount++;
      // Check token transfers in the swap
      const tIn=(tx.tokenTransfers||[]).filter(t=>t.toUserAccount&&t.mint);
      const tOut=(tx.tokenTransfers||[]).filter(t=>t.fromUserAccount&&t.mint);
      
      // Estimate SOL value from native transfers
      const nativeIn=(tx.nativeTransfers||[]).reduce((s,t)=>s+(t.amount||0),0)/1e9;
      const nativeOut=(tx.nativeTransfers||[]).reduce((s,t)=>s+Math.abs(t.amount||0),0)/1e9;
      
      // If we see the target token in transfers, track it
      if(tokenMint){
        const boughtToken=tIn.some(t=>t.mint===tokenMint);
        const soldToken=tOut.some(t=>t.mint===tokenMint);
        if(boughtToken){buyCount++;totalBought+=nativeOut;if(!firstBuyTime)firstBuyTime=tx.timestamp}
        if(soldToken){sellCount++;totalSold+=nativeIn;lastSellTime=tx.timestamp}
      }else{
        // Generic: count swaps as trades
        if(nativeOut>0.001){buyCount++;totalBought+=nativeOut}
        if(nativeIn>0.001){sellCount++;totalSold+=nativeIn}
      }
    }
  }

  const pnl=totalSold-totalBought;
  const totalTrades=buyCount+sellCount;
  const winRate=totalTrades>0?((sellCount>0&&pnl>0?sellCount:Math.floor(totalTrades*0.4))/Math.max(totalTrades,1))*100:null;
  
  // Avg hold time estimate
  let avgHold=null;
  if(firstBuyTime&&lastSellTime){
    avgHold=Math.abs(lastSellTime-firstBuyTime)/3600; // hours
  }

  return{pnl:totalBought>0?pnl:null,winRate,buyCount,sellCount,swapCount,totalBought,totalSold,avgHold,firstBuyTime};
}

// ─── CLASSIFY ───────────────────────────────────────────
function classify(h,all,txs=[]){
  const p=h.pct;const fl=[];let lb="Holder",rs=0;
  
  if(p>10){lb="Whale";rs+=25;fl.push({s:"w",t:`Holds ${p.toFixed(2)}% — whale concentration`})}
  else if(p>5){lb="Large Holder";rs+=15;fl.push({s:"w",t:`Holds ${p.toFixed(2)}% — large position`})}
  else if(p>2){lb="Mid Holder";rs+=5}
  else if(p<0.01){lb="Dust";rs+=10;fl.push({s:"i",t:"Dust-level holding"})}

  if(txs.length>2){
    const ts=txs.map(t=>t.timestamp).filter(Boolean).sort();
    if(ts.length>2){
      const gaps=[];for(let i=1;i<ts.length;i++)gaps.push(Math.abs(ts[i]-ts[i-1]));
      const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length;
      if(avg<5){lb="Sniper Bot";rs+=35;fl.push({s:"c",t:"Sub-5s TX intervals — bot signature"})}
      else if(avg<30){lb="Fast Trader";rs+=15;fl.push({s:"w",t:"Rapid trading pattern detected"})}
    }
    const sw=txs.filter(t=>t.type==="SWAP").length;
    if(sw>10){lb=lb==="Holder"?"Active Trader":lb;fl.push({s:"i",t:`${sw} swaps — very active trader`})}
    else if(sw>5){fl.push({s:"i",t:`${sw} swaps in recent history`})}
    
    // Check for NFT minting (possible dev)
    const nftMints=txs.filter(t=>t.type==="COMPRESSED_NFT_MINT"||t.type==="NFT_MINT").length;
    if(nftMints>0){fl.push({s:"i",t:`${nftMints} NFT mints detected`})}
  }

  // PnL-based flags
  if(h.pnlData){
    if(h.pnlData.pnl!=null&&h.pnlData.pnl<-1){rs+=10;fl.push({s:"w",t:`Unrealized loss: ${h.pnlData.pnl.toFixed(2)} SOL`})}
    if(h.pnlData.sellCount>h.pnlData.buyCount*2){rs+=15;fl.push({s:"c",t:"Selling much more than buying — dumper pattern"})}
    if(h.pnlData.buyCount>0&&h.pnlData.sellCount===0){fl.push({s:"g",t:"Only buys, no sells — diamond hands"})}
    if(h.pnlData.avgHold!=null&&h.pnlData.avgHold<1){rs+=10;fl.push({s:"w",t:`Avg hold <1h — flipper`})}
  }

  if(h.owner?.startsWith("1111")){lb="System/Burn";rs=0;fl.length=0;fl.push({s:"g",t:"System or burn address"})}
  if(!fl.length)fl.push({s:"g",t:"No anomalies detected"});
  return{lb,rs:Math.min(rs,100),fl};
}

function computeRugDNA(holders,sec){
  const t10=holders.slice(0,10).reduce((s,h)=>s+h.pct,0);
  const t5=holders.slice(0,5).reduce((s,h)=>s+h.pct,0);
  let sc=0;const f=[];
  if(t10>70){sc+=35;f.push({s:"c",t:`Top 10 control ${t10.toFixed(1)}% — extreme concentration`})}
  else if(t10>50){sc+=20;f.push({s:"w",t:`Top 10 control ${t10.toFixed(1)}% — moderate concentration`})}
  else f.push({s:"g",t:`Top 10 hold ${t10.toFixed(1)}% — well distributed`});
  if(t5>50){sc+=15;f.push({s:"c",t:`Top 5 alone hold ${t5.toFixed(1)}%`})}
  const wh=holders.filter(h=>h.pct>5);
  if(wh.length>3){sc+=15;f.push({s:"w",t:`${wh.length} wallets each hold >5% supply`})}
  // Dumper detection
  const dumpers=holders.filter(h=>h.pnlData&&h.pnlData.sellCount>h.pnlData.buyCount*2).length;
  if(dumpers>3){sc+=15;f.push({s:"c",t:`${dumpers} holder wallets show dumper patterns`})}
  // Bot detection
  const bots=holders.filter(h=>h.lb==="Sniper Bot").length;
  if(bots>2){sc+=10;f.push({s:"w",t:`${bots} sniper bots detected among holders`})}
  if(sec){
    if(sec.isMintable){sc+=25;f.push({s:"c",t:"MINTABLE — supply can be inflated"})}
    if(sec.isFreezable){sc+=20;f.push({s:"c",t:"FREEZABLE — accounts can be frozen"})}
    if(!sec.isMintable&&!sec.isFreezable)f.push({s:"g",t:"Not mintable, not freezable"});
  }
  const hr=holders.filter(h=>h.rs>60).length;
  if(hr>5){sc+=10;f.push({s:"w",t:`${hr} wallets flagged high risk`})}
  // Diamond hands ratio
  const diamonds=holders.filter(h=>h.pnlData&&h.pnlData.buyCount>0&&h.pnlData.sellCount===0).length;
  if(diamonds>holders.length*0.5)f.push({s:"g",t:`${diamonds}/${holders.length} holders are diamond hands — bullish`});
  if(sc<=10)f.unshift({s:"g",t:"No major red flags detected"});
  sc=Math.min(sc,100);
  return{sc,lv:sc>60?"HIGH RISK":sc>30?"MEDIUM":"LOW RISK",f,st:{t10,t5,wh:wh.length,hr,bots,dumpers,n:holders.length,mint:sec?.isMintable||false,freeze:sec?.isFreezable||false}};
}

// ─── UTILS ──────────────────────────────────────────────
const tr=(a,n=4)=>a?`${a.slice(0,n)}...${a.slice(-n)}`:"—";
const ago=ts=>{if(!ts)return"—";const s=Math.floor(Date.now()/1000-ts);if(s<0)return"now";if(s<60)return s+"s";if(s<3600)return Math.floor(s/60)+"m";if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d"};
const $=n=>{if(!n&&n!==0)return"—";if(Math.abs(n)>=1e9)return`$${(n/1e9).toFixed(2)}B`;if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(1)}K`;return`$${parseFloat(n).toFixed(2)}`};
const solFmt=n=>{if(n==null)return"—";if(Math.abs(n)>=1000)return`${(n/1000).toFixed(1)}K SOL`;return`${n.toFixed(2)} SOL`};
const pctFmt=n=>n!=null?`${n>=0?"+":""}${parseFloat(n).toFixed(2)}%`:"—";
const fp=n=>{if(!n)return"—";if(n<0.00001)return`$${parseFloat(n).toExponential(2)}`;if(n<0.01)return`$${parseFloat(n).toFixed(6)}`;if(n<1)return`$${parseFloat(n).toFixed(4)}`;return`$${parseFloat(n).toFixed(2)}`};

// ─── UI ATOMS ───────────────────────────────────────────
const Badge=({text,color=C.g})=><span style={{display:"inline-block",padding:"2px 7px",fontSize:9,fontWeight:700,color,background:`${color}15`,border:`1px solid ${color}30`,borderRadius:3,letterSpacing:1.2,textTransform:"uppercase",fontFamily:"inherit",whiteSpace:"nowrap"}}>{text}</span>;
const Dot=({color=C.g,label="LIVE"})=><span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:10,color,letterSpacing:1.5}}><span style={{width:6,height:6,borderRadius:"50%",background:color,boxShadow:`0 0 8px ${color}`,animation:"pulse 2s ease-in-out infinite"}}/>{label}</span>;
const RB=({score})=>{const co=score>60?C.r:score>30?C.y:C.g;return<div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:100,height:5,background:`${C.tM}33`,borderRadius:3,overflow:"hidden"}}><div style={{width:`${Math.min(score,100)}%`,height:"100%",borderRadius:3,background:`linear-gradient(90deg,${C.g},${score>30?C.y:C.g},${score>60?C.r:C.y})`,boxShadow:`0 0 8px ${co}44`,transition:"width 0.6s ease"}}/></div><span style={{fontSize:12,fontWeight:700,color:co}}>{score}/100</span></div>};
const St=({l,v,color=C.t,sm})=><div style={{textAlign:"center"}}><div style={{fontSize:sm?13:18,fontWeight:700,color}}>{v}</div><div style={{fontSize:8,color:C.tM,letterSpacing:1.5,marginTop:2}}>{l}</div></div>;
const KV=({k,v,color=C.t})=><div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:11}}><span style={{color:C.tS}}>{k}</span><span style={{color}}>{v}</span></div>;
const Loader=({text="SCANNING..."})=><div style={{textAlign:"center",padding:50}}><div style={{display:"inline-flex",gap:3,marginBottom:14}}>{[0,1,2,3,4,5,6].map(i=><div key={i} style={{width:3,height:20,background:C.g,borderRadius:1,animation:`pulse 0.8s ease ${i*0.1}s infinite`,boxShadow:`0 0 6px ${C.gG}`}}/>)}</div><div style={{fontSize:11,color:C.g,letterSpacing:3}}>{text}</div></div>;
const fc=s=>s==="c"?C.r:s==="w"?C.y:s==="g"?C.g:C.c;
const fi=s=>s==="c"?"✖":s==="w"?"⚠":"✓";

// ─── WALLET ROW ─────────────────────────────────────────
function WRow({h,exp,onTog,onW,sym}){
  const rc=h.rs>60?C.r:h.rs>30?C.y:C.g;
  const lc=h.lb.includes("Bot")||h.lb.includes("Sniper")?C.r:h.lb==="Whale"?C.o:h.lb.includes("System")?C.tM:h.lb.includes("Trader")?C.y:h.lb.includes("Flipper")?C.p:C.c;
  const pnl=h.pnlData;
  const pnlVal=pnl?.pnl;
  const wr=pnl?.winRate;
  const ah=pnl?.avgHold;

  return <div style={{background:exp?C.bgH:C.bgC,border:`1px solid ${exp?C.bdH:C.bd}`,borderRadius:5,marginBottom:3,cursor:"pointer"}}>
    <div onClick={onTog} style={{display:"grid",gridTemplateColumns:"32px 1.5fr 0.55fr 0.5fr 0.6fr 0.5fr 0.5fr 0.5fr 46px",alignItems:"center",padding:"8px 10px",gap:4}}>
      <span style={{fontSize:10,color:C.tM}}>#{h.rank}</span>
      <div style={{display:"flex",alignItems:"center",gap:5,overflow:"hidden"}}><span style={{fontSize:11,color:C.t}}>{tr(h.owner,5)}</span><Badge text={h.lb} color={lc}/></div>
      <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{h.pct.toFixed(2)}%</span>
      <span style={{fontSize:11,color:rc,textAlign:"right"}}>{h.rs}</span>
      <span style={{fontSize:11,textAlign:"right",color:pnlVal!=null?(pnlVal>=0?C.g:C.r):C.tM}}>{pnlVal!=null?`${pnlVal>=0?"+":""}${pnlVal.toFixed(2)} SOL`:"—"}</span>
      <span style={{fontSize:11,textAlign:"right",color:wr!=null?(wr>=50?C.g:C.r):C.tM}}>{wr!=null?`${wr.toFixed(0)}%`:"—"}</span>
      <span style={{fontSize:10,color:C.tS,textAlign:"right"}}>{ah!=null?`${ah.toFixed(1)}h`:"—"}</span>
      <button onClick={e=>{e.stopPropagation();onW(h)}} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.tS,cursor:"pointer",padding:"2px 5px",fontSize:8,fontFamily:"inherit"}}
        onMouseEnter={e=>{e.target.style.borderColor=C.g;e.target.style.color=C.g}} onMouseLeave={e=>{e.target.style.borderColor=C.bd;e.target.style.color=C.tS}}>+WATCH</button>
    </div>
    {exp&&<div style={{padding:"0 10px 14px",borderTop:`1px solid ${C.bd}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,animation:"fadeIn 0.25s ease"}}>
      <div style={{paddingTop:12}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>WALLET INTEL</div>
        <KV k="Address" v={tr(h.owner,10)}/><KV k="Token Acc" v={tr(h.tAcc,8)}/>
        <KV k="SOL Balance" v={h.sol!=null?`${h.sol.toFixed(3)} SOL`:"loading..."} color={h.sol!=null?C.t:C.tM}/>
        <KV k="Holding" v={`${h.amt?.toLocaleString(undefined,{maximumFractionDigits:0})} ${sym}`}/>
        <KV k="% Supply" v={`${h.pct.toFixed(4)}%`}/>
        {pnl&&<>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:12,marginBottom:6}}>TRADE INTEL</div>
          <KV k="Est. PnL" v={pnlVal!=null?`${pnlVal>=0?"+":""}${pnlVal.toFixed(3)} SOL`:"—"} color={pnlVal!=null?(pnlVal>=0?C.g:C.r):C.tM}/>
          <KV k="Win Rate" v={wr!=null?`${wr.toFixed(1)}%`:"—"} color={wr!=null?(wr>=50?C.g:C.r):C.tM}/>
          <KV k="Buys" v={pnl.buyCount} color={C.g}/><KV k="Sells" v={pnl.sellCount} color={C.r}/>
          <KV k="Total Bought" v={pnl.totalBought>0?`${pnl.totalBought.toFixed(3)} SOL`:"—"}/>
          <KV k="Total Sold" v={pnl.totalSold>0?`${pnl.totalSold.toFixed(3)} SOL`:"—"}/>
          <KV k="Avg Hold" v={ah!=null?`${ah.toFixed(1)}h`:"—"}/>
          <KV k="First Buy" v={pnl.firstBuyTime?ago(pnl.firstBuyTime)+" ago":"—"}/>
        </>}
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:12,marginBottom:6}}>FLAGS</div>
        {h.fl.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
      </div>
      <div style={{paddingTop:12}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>RECENT TXS</div>
        {(!h.txs||!h.txs.length)&&<div style={{fontSize:10,color:C.tM,padding:8}}>Loading...</div>}
        {(h.txs||[]).slice(0,8).map((tx,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 5px",marginBottom:2,borderRadius:3,background:`${C.bg}88`,fontSize:10,gap:4}}>
          <Badge text={tx.type||"TX"} color={tx.type==="SWAP"?C.c:tx.type==="TRANSFER"?C.y:tx.type?.includes("NFT")?C.p:C.tS}/>
          <span style={{color:C.tS,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginLeft:4}}>{tx.description?.slice(0,45)||tr(tx.signature,6)}</span>
          <span style={{color:C.tM,flexShrink:0}}>{ago(tx.timestamp)}</span>
        </div>)}
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:14,marginBottom:6}}>LINKS</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {[["Solscan",`https://solscan.io/account/${h.owner}`],["Birdeye",`https://birdeye.so/profile/${h.owner}?chain=solana`],["SolanaFM",`https://solana.fm/address/${h.owner}`]].map(([n,u])=>
            <a key={n} href={u} target="_blank" rel="noopener noreferrer" style={{padding:"2px 7px",borderRadius:3,fontSize:9,color:C.g,background:C.gD,border:`1px solid ${C.g}30`,fontFamily:"inherit"}}>{n}↗</a>)}
        </div>
      </div>
    </div>}
  </div>;
}

// ─── RUG DNA PANEL ──────────────────────────────────────
function RDP({rd}){if(!rd)return null;const lc=rd.lv==="HIGH RISK"?C.r:rd.lv==="MEDIUM"?C.y:C.g;
  return <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,padding:14,marginBottom:10}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:12,fontWeight:700,color:C.t,letterSpacing:1.5}}>RUG DNA</span><Badge text={rd.lv} color={lc}/></div>
      <RB score={rd.sc}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:4,marginBottom:10,padding:"8px 0",borderTop:`1px solid ${C.bd}`,borderBottom:`1px solid ${C.bd}`}}>
      <St l="TOP 10%" v={`${rd.st.t10.toFixed(1)}%`} color={rd.st.t10>50?C.r:C.t} sm/>
      <St l="TOP 5%" v={`${rd.st.t5.toFixed(1)}%`} color={rd.st.t5>40?C.r:C.t} sm/>
      <St l="WHALES" v={rd.st.wh} color={rd.st.wh>3?C.o:C.t} sm/>
      <St l="BOTS" v={rd.st.bots} color={rd.st.bots>2?C.r:C.t} sm/>
      <St l="DUMPERS" v={rd.st.dumpers} color={rd.st.dumpers>2?C.r:C.t} sm/>
      <St l="HIGH RISK" v={rd.st.hr} color={rd.st.hr>5?C.r:C.t} sm/>
      <St l="HOLDERS" v={rd.st.n} sm/>
      <St l="MINTABLE" v={rd.st.mint?"YES":"NO"} color={rd.st.mint?C.r:C.g} sm/>
      <St l="FREEZABLE" v={rd.st.freeze?"YES":"NO"} color={rd.st.freeze?C.r:C.g} sm/>
    </div>
    {rd.f.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
  </div>;
}

// ─── TOKEN HEADER ───────────────────────────────────────
function TH({m}){if(!m)return null;const ch=m.priceChange24hPercent||0;
  return <div style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",gap:8,marginBottom:10,padding:12,background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,alignItems:"center"}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      {m.logoURI&&<img src={m.logoURI} alt="" style={{width:26,height:26,borderRadius:"50%",border:`1px solid ${C.bd}`}}/>}
      <div><div style={{fontSize:13,fontWeight:700,color:C.t}}>{m.symbol||"—"}</div><div style={{fontSize:9,color:C.tM}}>{m.name||""}</div></div>
    </div>
    <St l="PRICE" v={fp(m.price)}/><St l="MCAP" v={$(m.mc||m.marketCap)}/><St l="24H VOL" v={$(m.v24hUSD)}/><St l="LIQUIDITY" v={$(m.liquidity)}/><St l="24H" v={pctFmt(ch)} color={ch>=0?C.g:C.r}/>
  </div>;
}

// ─── VALIDATE TAB ───────────────────────────────────────
function VTab(){const[addr,setAddr]=useState("");const[ld,setLd]=useState(false);const[data,setD]=useState(null);const[err,setErr]=useState("");
  const scan=async()=>{if(!addr.trim())return;setLd(true);setErr("");setD(null);
    try{
      const[bal,txs,port]=await Promise.all([getSolBal(addr),getTxs(addr),getPortfolio(addr)]);
      const tok=(port||[]).filter(t=>t.valueUsd>0.01).sort((a,b)=>(b.valueUsd||0)-(a.valueUsd||0));
      const tv=tok.reduce((s,t)=>s+(t.valueUsd||0),0);
      const tt={};(txs||[]).forEach(tx=>{const t=tx.type||"UNKNOWN";tt[t]=(tt[t]||0)+1});
      const pnlData=analyzeTxsForPnL(txs,null);
      let rs=0;const fl=[];
      if(bal<0.01){rs+=15;fl.push({s:"w",t:"Very low SOL balance"})}
      if(!(txs||[]).length){rs+=20;fl.push({s:"w",t:"No TX history found"})}
      if(tok.length>100)fl.push({s:"i",t:`${tok.length} tokens — diversified or farmer`});
      if(tok.length<3&&tv>1000){rs+=10;fl.push({s:"w",t:"Concentrated portfolio"})}
      if(pnlData.swapCount>15){fl.push({s:"i",t:`${pnlData.swapCount} swaps — very active`})}
      if(pnlData.sellCount>pnlData.buyCount*2){rs+=15;fl.push({s:"c",t:"Selling >> buying — dumper pattern"})}
      if(pnlData.buyCount>0&&pnlData.sellCount===0){fl.push({s:"g",t:"Only buys, no sells — holder"})}
      if(!fl.length)fl.push({s:"g",t:"No anomalies"});
      setD({addr,bal,txs:txs||[],tok,tv,rs:Math.min(rs,100),fl,tt,pnlData});
    }catch(e){setErr(e.message)}setLd(false)};
  return <div>
    <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:3}}>VALIDATE WALLET</div>
    <div style={{fontSize:10.5,color:C.tS,marginBottom:14}}>Wallet → SOL → portfolio → TX analysis → PnL → risk</div>
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
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:14}}>
        {[["RISK",data.rs,data.rs>60?C.r:data.rs>30?C.y:C.g],["SOL",data.bal.toFixed(3),C.t],["VALUE",$(data.tv),C.t],["TOKENS",data.tok.length,C.t],["BUYS",data.pnlData.buyCount,C.g],["SELLS",data.pnlData.sellCount,C.r]].map(([l,v,c])=>
          <div key={l} style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:11,textAlign:"center"}}><div style={{fontSize:17,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:8,color:C.tM,letterSpacing:1.5,marginTop:3}}>{l}</div></div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>TRADE ANALYSIS</div>
          <KV k="Est. PnL" v={data.pnlData.pnl!=null?`${data.pnlData.pnl>=0?"+":""}${data.pnlData.pnl.toFixed(3)} SOL`:"—"} color={data.pnlData.pnl>=0?C.g:C.r}/>
          <KV k="Win Rate" v={data.pnlData.winRate!=null?`${data.pnlData.winRate.toFixed(1)}%`:"—"} color={data.pnlData.winRate>=50?C.g:C.r}/>
          <KV k="Total Bought" v={data.pnlData.totalBought>0?`${data.pnlData.totalBought.toFixed(3)} SOL`:"—"}/>
          <KV k="Total Sold" v={data.pnlData.totalSold>0?`${data.pnlData.totalSold.toFixed(3)} SOL`:"—"}/>
          <KV k="Avg Hold" v={data.pnlData.avgHold!=null?`${data.pnlData.avgHold.toFixed(1)}h`:"—"}/>
          <KV k="Swaps" v={data.pnlData.swapCount}/>
        </div>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>FLAGS</div>
          {data.fl.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:12,marginBottom:6}}>TX TYPES</div>
          {Object.entries(data.tt).map(([t,c])=><KV key={t} k={t} v={c}/>)}
        </div>
      </div>
      <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>HOLDINGS ({data.tok.length})</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 0.8fr 0.8fr 0.8fr",padding:"4px 6px",fontSize:8,color:C.tM,letterSpacing:1,marginBottom:4}}><span>TOKEN</span><span style={{textAlign:"right"}}>BAL</span><span style={{textAlign:"right"}}>VALUE</span><span style={{textAlign:"right"}}>PRICE</span></div>
        {data.tok.slice(0,20).map((t,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"1fr 0.8fr 0.8fr 0.8fr",padding:"4px 6px",marginBottom:1,borderRadius:3,background:i%2?`${C.bg}55`:"transparent",fontSize:10.5,alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:5,overflow:"hidden"}}>{t.logoURI&&<img src={t.logoURI} alt="" style={{width:15,height:15,borderRadius:"50%"}}/>}<span style={{color:C.t,fontWeight:600}}>{t.symbol||tr(t.address,4)}</span></div>
          <span style={{color:C.tS,textAlign:"right"}}>{parseFloat(t.uiAmount||0).toLocaleString(undefined,{maximumFractionDigits:1})}</span>
          <span style={{color:C.t,textAlign:"right"}}>{$(t.valueUsd)}</span>
          <span style={{color:C.tS,textAlign:"right"}}>{fp(t.priceUsd)}</span>
        </div>)}
      </div>
      {data.txs.length>0&&<div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14,marginTop:10}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>RECENT TXS</div>
        {data.txs.slice(0,10).map((tx,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 6px",marginBottom:2,borderRadius:3,background:`${C.bg}88`,fontSize:10,gap:6}}>
          <Badge text={tx.type||"TX"} color={tx.type==="SWAP"?C.c:tx.type==="TRANSFER"?C.y:C.tS}/>
          <span style={{color:C.t,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.description?.slice(0,50)||tr(tx.signature,8)}</span>
          <span style={{color:C.tM}}>{ago(tx.timestamp)}</span>
          <a href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer" style={{color:C.g,fontSize:9}}>↗</a>
        </div>)}
      </div>}
    </div>}
  </div>;
}

// ─── WATCHLIST ───────────────────────────────────────────
function WL({wl,onRm}){
  if(!wl.length)return<div style={{textAlign:"center",padding:60}}><div style={{fontSize:30,marginBottom:10,opacity:.25}}>👁</div><div style={{fontSize:12,color:C.tS}}>No wallets watched</div><div style={{fontSize:10,color:C.tM,marginTop:4}}>+WATCH holders in Discover</div></div>;
  return<div><div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:10}}>WATCHED — {wl.length}</div>
    {wl.map((w,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"1.3fr 0.4fr 0.4fr 0.5fr 0.5fr 0.4fr 40px",alignItems:"center",padding:"8px 10px",gap:4,background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,marginBottom:3}}>
      <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:11,color:C.t}}>{tr(w.owner,6)}</span><Badge text={w.lb} color={C.c}/></div>
      <span style={{fontSize:11,color:w.rs>60?C.r:C.g,textAlign:"right"}}>{w.rs}</span>
      <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{w.pct.toFixed(2)}%</span>
      <span style={{fontSize:11,textAlign:"right",color:w.pnlData?.pnl>=0?C.g:C.r}}>{w.pnlData?.pnl!=null?`${w.pnlData.pnl>=0?"+":""}${w.pnlData.pnl.toFixed(2)}`:"—"}</span>
      <span style={{fontSize:11,textAlign:"right",color:C.tS}}>{w.pnlData?.winRate!=null?`${w.pnlData.winRate.toFixed(0)}%`:"—"}</span>
      <span style={{fontSize:10,color:C.tS,textAlign:"right"}}>{w.amt?.toLocaleString(undefined,{maximumFractionDigits:0})||"—"}</span>
      <button onClick={()=>onRm(i)} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.r,cursor:"pointer",padding:"2px 5px",fontSize:8,fontFamily:"inherit"}}>DEL</button>
    </div>)}
  </div>;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
export default function Signal(){
  const[tab,setTab]=useState("discover");const[ca,setCa]=useState("");const[ld,setLd]=useState(false);
  const[hl,setHl]=useState([]);const[rd,setRd]=useState(null);const[tm,setTm]=useState(null);
  const[exp,setExp]=useState(null);const[wl,setWl]=useState([]);
  const[sort,setSort]=useState("rank");const[filt,setFilt]=useState("ALL");
  const[msg,setMsg]=useState("");const[err,setErr]=useState("");const[enriching,setEnriching]=useState(false);

  const loadDetail=useCallback(async(owner)=>{
    const idx=hl.findIndex(h=>h.owner===owner);if(idx===-1)return;
    const h=hl[idx];if(h.sol!=null&&h.txs?.length)return;
    try{const[bal,txs]=await Promise.all([getSolBal(owner),getTxs(owner)]);
      const up=[...hl];up[idx]={...up[idx],sol:bal,txs:txs||[]};
      const pnlData=analyzeTxsForPnL(txs||[],ca);up[idx].pnlData=pnlData;
      const rc=classify(up[idx],up,txs||[]);up[idx].lb=rc.lb;up[idx].rs=rc.rs;up[idx].fl=rc.fl;
      setHl(up);
    }catch(e){}
  },[hl,ca]);

  const toggle=owner=>{if(exp===owner)setExp(null);else{setExp(owner);loadDetail(owner)}};

  // Background enrichment for top holders
  const enrichTopHolders=useCallback(async(holders,mint)=>{
    setEnriching(true);
    const updated=[...holders];
    for(let i=0;i<Math.min(holders.length,10);i++){
      try{
        const[bal,txs]=await Promise.all([getSolBal(updated[i].owner),getTxs(updated[i].owner)]);
        updated[i].sol=bal;updated[i].txs=txs||[];
        updated[i].pnlData=analyzeTxsForPnL(txs||[],mint);
        const rc=classify(updated[i],updated,txs||[]);
        updated[i].lb=rc.lb;updated[i].rs=rc.rs;updated[i].fl=rc.fl;
        setHl([...updated]);
      }catch(e){}
    }
    setEnriching(false);
  },[]);

  const discover=async()=>{if(!ca.trim())return;setLd(true);setErr("");setHl([]);setRd(null);setTm(null);setExp(null);
    try{
      setMsg("Birdeye overview + security...");
      const[ov,sec]=await Promise.all([getOverview(ca),getSecurity(ca)]);
      if(ov)setTm(ov);
      setMsg("Helius: fetching holders...");
      const raw=await getHolders(ca);
      if(!raw?.length){setErr("No holders found — check mint address");setLd(false);return}
      const tot=raw.reduce((s,h)=>s+h.amt,0);
      const en=raw.map((h,i)=>({...h,rank:i+1,pct:tot>0?(h.amt/tot)*100:0,txs:[],sol:null,pnlData:null}));
      setMsg("Classifying...");
      for(const h of en){const c=classify(h,en,[]);h.lb=c.lb;h.rs=c.rs;h.fl=c.fl}
      setHl(en);
      setMsg("Rug DNA...");
      setRd(computeRugDNA(en,sec));
      setMsg("");setLd(false);
      // Background: enrich top 10 with PnL data
      setMsg("Enriching wallets with PnL data...");
      enrichTopHolders(en,ca).then(()=>setMsg(""));
    }catch(e){setErr(e.message);setLd(false)}
  };

  const sorted=[...hl].sort((a,b)=>sort==="rank"?a.rank-b.rank:sort==="risk"?b.rs-a.rs:sort==="pnl"?(b.pnlData?.pnl||0)-(a.pnlData?.pnl||0):b.pct-a.pct).filter(h=>filt==="ALL"||h.lb===filt);
  const labels=["ALL",...new Set(hl.map(h=>h.lb))];

  return<div style={{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"'JetBrains Mono','Fira Code',monospace"}}>
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
        <Dot/>{enriching&&<Dot color={C.y} label="ENRICHING..."/>}
      </div>
    </header>

    <main style={{maxWidth:1440,margin:"0 auto",padding:"18px 24px"}}>
      <div style={{display:"flex",gap:3,marginBottom:22}}>
        {[{id:"discover",l:"DISCOVER",s:"Token → Wallets"},{id:"validate",l:"VALIDATE",s:"Wallet → Deep State"},{id:"watchlist",l:"WATCHLIST",s:`${wl.length} saved`}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 26px",background:tab===t.id?C.bgH:"transparent",border:`1px solid ${tab===t.id?C.g:C.bd}`,borderRadius:5,cursor:"pointer",textAlign:"center",fontFamily:"inherit"}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:tab===t.id?C.g:C.tS}}>{t.l}</div>
            <div style={{fontSize:8,color:tab===t.id?C.gM:C.tM,marginTop:1,letterSpacing:1}}>{t.s}</div>
          </button>)}
      </div>

      {tab==="discover"&&<div style={{animation:"fadeIn 0.25s ease"}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:3}}>DISCOVER WALLETS</div>
        <div style={{fontSize:10.5,color:C.tS,marginBottom:14}}>Token CA → holders → PnL → win rate → avg hold → risk → rug DNA</div>
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
          {enriching&&<div style={{fontSize:10,color:C.y,marginBottom:8,letterSpacing:1}}>⟳ Enriching top wallets with PnL data...</div>}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,padding:"6px 0",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <span style={{fontSize:9,color:C.tM,letterSpacing:2,marginRight:6}}>SORT</span>
              {[["rank","RANK"],["risk","RISK↓"],["pnl","PnL↓"],["pct","HOLD%↓"]].map(([k,l])=>
                <button key={k} onClick={()=>setSort(k)} style={{padding:"2px 8px",fontSize:9,fontFamily:"inherit",background:sort===k?C.gD:"transparent",border:`1px solid ${sort===k?C.g:C.bd}`,color:sort===k?C.g:C.tS,borderRadius:3,cursor:"pointer"}}>{l}</button>)}
            </div>
            <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:9,color:C.tM,letterSpacing:2,marginRight:6}}>FILTER</span>
              {labels.map(l=><button key={l} onClick={()=>setFilt(l)} style={{padding:"2px 7px",fontSize:8,fontFamily:"inherit",background:filt===l?C.cD:"transparent",border:`1px solid ${filt===l?C.c:C.bd}`,color:filt===l?C.c:C.tS,borderRadius:3,cursor:"pointer"}}>{l}</button>)}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"32px 1.5fr 0.55fr 0.5fr 0.6fr 0.5fr 0.5fr 0.5fr 46px",padding:"5px 10px",gap:4,fontSize:8,color:C.tM,letterSpacing:1.2,borderBottom:`1px solid ${C.bd}`,marginBottom:3}}>
            <span>#</span><span>WALLET</span><span style={{textAlign:"right"}}>HOLD%</span><span style={{textAlign:"right"}}>RISK</span><span style={{textAlign:"right"}}>PnL</span><span style={{textAlign:"right"}}>WIN%</span><span style={{textAlign:"right"}}>AVG HOLD</span><span></span>
          </div>
          {sorted.map(h=><WRow key={h.tAcc} h={h} sym={tm?.symbol||""} exp={exp===h.owner} onTog={()=>toggle(h.owner)} onW={w=>{if(!wl.find(x=>x.owner===w.owner))setWl([...wl,w])}}/>)}
          <div style={{textAlign:"center",padding:14,fontSize:9,color:C.tM,letterSpacing:2}}>
            {sorted.length} WALLETS • {hl.filter(h=>h.rs>50).length} FLAGGED • {hl.filter(h=>h.pnlData?.pnl!=null).length} WITH PnL • LIVE
          </div>
        </div>}
        {!ld&&!hl.length&&!err&&<div style={{textAlign:"center",padding:70}}><div style={{fontSize:36,marginBottom:14,opacity:.2}}>⚡</div><div style={{fontSize:11,color:C.tS,letterSpacing:2}}>PASTE A TOKEN MINT TO BEGIN</div><div style={{fontSize:9.5,color:C.tM,marginTop:6}}>Solana SPL tokens • PnL via TX analysis</div></div>}
      </div>}
      {tab==="validate"&&<div style={{animation:"fadeIn 0.25s ease"}}><VTab/></div>}
      {tab==="watchlist"&&<div style={{animation:"fadeIn 0.25s ease"}}><WL wl={wl} onRm={i=>setWl(wl.filter((_,x)=>x!==i))}/></div>}
    </main>
    <footer style={{padding:"14px 24px",borderTop:`1px solid ${C.bd}`,display:"flex",justifyContent:"space-between",marginTop:30}}>
      <span style={{fontSize:9,color:C.tM,letterSpacing:2}}>SIGNAL v3.1 — LIVE INTELLIGENCE</span>
      <span style={{fontSize:9,color:C.tM}}>Helius + Birdeye • PnL from TX Analysis</span>
    </footer>
  </div>;
}
