import { useState, useCallback, useRef } from "react";

const HK="efb053d6-f7c7-4c90-9bc5-0ce3af9c59df";
const BK="94ba9de0953642878038f5a7eccc1114";
const RPC=`https://mainnet.helius-rpc.com/?api-key=${HK}`;
const HAPI=`https://api.helius.xyz/v0`;
const BAPI=`https://public-api.birdeye.so`;
const C={bg:"#05070b",bgS:"#0a0e17",bgC:"#0d1219",bgH:"#121a27",bd:"#161f30",bdH:"#1e3a2a",g:"#00ff88",gD:"#00ff8820",gM:"#00cc6a",gG:"#00ff8840",r:"#ff2e4c",rD:"#ff2e4c18",y:"#ffc800",yD:"#ffc80018",c:"#00cfff",cD:"#00cfff18",p:"#b44dff",o:"#ff8c00",t:"#dfe6f0",tS:"#5a6e8a",tM:"#2d3d56"};

// ─── API ────────────────────────────────────────────────
async function rpcCall(m,p){try{const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});return(await r.json()).result||null}catch{return null}}
async function bGet(ep,params={}){try{const u=new URL(`${BAPI}${ep}`);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{headers:{"X-API-KEY":BK,"x-chain":"solana"}});if(!r.ok)return null;return await r.json()}catch{return null}}
async function getOverview(a){return(await bGet("/defi/token_overview",{address:a}))?.data||null}
async function getSecurity(a){return(await bGet("/defi/token_security",{address:a}))?.data||null}

async function getHolders(mint){
  const lg=await rpcCall("getTokenLargestAccounts",[mint]);
  if(!lg?.value)return[];const out=[];
  // Batch: fire all getAccountInfo in parallel
  const infos=await Promise.all(lg.value.slice(0,20).map(ac=>
    rpcCall("getAccountInfo",[ac.address,{encoding:"jsonParsed"}]).then(info=>{
      const p=info?.value?.data?.parsed?.info;
      return p?{tAcc:ac.address,owner:p.owner,amt:parseFloat(p.tokenAmount?.uiAmountString||"0")}
              :{tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0")};
    }).catch(()=>({tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0")}))
  ));
  return infos;
}

async function getSolBal(a){const r=await rpcCall("getBalance",[a]);return r?r/1e9:0}
async function getTxs(a){try{return await(await fetch(`${HAPI}/addresses/${a}/transactions?api-key=${HK}&limit=20`)).json()}catch{return[]}}
async function getPortfolio(a){return(await bGet("/v1/wallet/token_list",{wallet:a}))?.data?.items||[]}

// ─── BIRDEYE: Wallet token trade data (the key to real PnL) ─────
async function getWalletTokenTrades(wallet, tokenAddr){
  // Get trade history for this wallet on this specific token
  const d=await bGet("/v1/wallet/tx_list",{wallet,limit:"20"});
  return d?.data?.items||d?.data||[];
}

// Parse Helius enhanced TXs for PnL on a specific token
function parseTxPnL(txs, tokenMint, walletAddr){
  let solSpent=0, solReceived=0, tokenBought=0, tokenSold=0;
  let buyCount=0, sellCount=0, firstBuy=null, lastTx=null;
  const trades=[];

  for(const tx of (txs||[])){
    if(!tx.tokenTransfers?.length && !tx.nativeTransfers?.length) continue;
    lastTx=tx.timestamp;
    
    const tokenXfers=(tx.tokenTransfers||[]);
    const nativeXfers=(tx.nativeTransfers||[]);
    
    // Find transfers involving our target token
    const tokenIn=tokenXfers.filter(t=>t.mint===tokenMint && t.toUserAccount===walletAddr);
    const tokenOut=tokenXfers.filter(t=>t.mint===tokenMint && t.fromUserAccount===walletAddr);
    
    if(tokenIn.length>0){
      // BOUGHT token: wallet received token, likely sent SOL
      const tokAmt=tokenIn.reduce((s,t)=>s+Math.abs(parseFloat(t.tokenAmount||0)),0);
      const solOut=nativeXfers.filter(t=>t.fromUserAccount===walletAddr).reduce((s,t)=>s+Math.abs(t.amount||0)/1e9,0);
      if(tokAmt>0){
        buyCount++;tokenBought+=tokAmt;solSpent+=solOut;
        if(!firstBuy)firstBuy=tx.timestamp;
        trades.push({type:"BUY",token:tokAmt,sol:solOut,ts:tx.timestamp,sig:tx.signature});
      }
    }
    if(tokenOut.length>0){
      // SOLD token: wallet sent token, likely received SOL
      const tokAmt=tokenOut.reduce((s,t)=>s+Math.abs(parseFloat(t.tokenAmount||0)),0);
      const solIn=nativeXfers.filter(t=>t.toUserAccount===walletAddr).reduce((s,t)=>s+Math.abs(t.amount||0)/1e9,0);
      if(tokAmt>0){
        sellCount++;tokenSold+=tokAmt;solReceived+=solIn;
        trades.push({type:"SELL",token:tokAmt,sol:solIn,ts:tx.timestamp,sig:tx.signature});
      }
    }
  }

  const pnlSol=solReceived-solSpent;
  const totalTrades=buyCount+sellCount;
  // Win rate: if they sold for more than they bought per trade
  const wins=trades.filter(t=>t.type==="SELL"&&t.sol>0).length;
  const winRate=sellCount>0?(wins/sellCount)*100:buyCount>0?0:null;
  const avgHold=firstBuy&&lastTx?Math.abs(lastTx-firstBuy)/3600:null;

  return{
    pnlSol: totalTrades>0?pnlSol:null,
    solSpent, solReceived, tokenBought, tokenSold,
    buyCount, sellCount, winRate, avgHold, firstBuy,
    trades, totalTrades
  };
}

// Also compute general wallet PnL from ALL swaps (for validate tab)
function parseGeneralPnL(txs, walletAddr){
  let swaps=0, transfers=0, other=0;
  let totalSolIn=0, totalSolOut=0;
  const types={};
  
  for(const tx of (txs||[])){
    const t=tx.type||"UNKNOWN";
    types[t]=(types[t]||0)+1;
    
    if(tx.type==="SWAP"){
      swaps++;
      const nIn=(tx.nativeTransfers||[]).filter(n=>n.toUserAccount===walletAddr).reduce((s,n)=>s+(n.amount||0)/1e9,0);
      const nOut=(tx.nativeTransfers||[]).filter(n=>n.fromUserAccount===walletAddr).reduce((s,n)=>s+(n.amount||0)/1e9,0);
      totalSolIn+=nIn;totalSolOut+=nOut;
    }
  }
  return{swaps,types,pnlSol:totalSolIn-totalSolOut,totalSolIn,totalSolOut};
}

// ─── CLASSIFY ───────────────────────────────────────────
function classify(h, all){
  const p=h.pct;const fl=[];let lb="Holder",rs=0;
  if(p>10){lb="Whale";rs+=25;fl.push({s:"w",t:`Holds ${p.toFixed(2)}% — whale`})}
  else if(p>5){lb="Large Holder";rs+=15;fl.push({s:"w",t:`${p.toFixed(2)}% — large`})}
  else if(p>2){lb="Mid Holder";rs+=5}
  else if(p<0.01){lb="Dust";rs+=10;fl.push({s:"i",t:"Dust holding"})}

  const pnl=h.pnlData;
  if(pnl){
    if(pnl.sellCount>pnl.buyCount*2&&pnl.sellCount>2){lb="Dumper";rs+=20;fl.push({s:"c",t:`${pnl.sellCount} sells vs ${pnl.buyCount} buys — dumping`})}
    else if(pnl.buyCount>0&&pnl.sellCount===0){fl.push({s:"g",t:"Diamond hands — only buys, zero sells"})}
    if(pnl.avgHold!=null&&pnl.avgHold<0.5&&pnl.totalTrades>2){lb="Flipper";rs+=15;fl.push({s:"w",t:`Avg hold ${(pnl.avgHold*60).toFixed(0)}min — flipper`})}
    if(pnl.pnlSol!=null&&pnl.pnlSol>1){fl.push({s:"g",t:`Profitable: +${pnl.pnlSol.toFixed(2)} SOL`})}
    if(pnl.pnlSol!=null&&pnl.pnlSol<-1){rs+=10;fl.push({s:"w",t:`Losing: ${pnl.pnlSol.toFixed(2)} SOL`})}
  }

  // TX-based classification
  if(h.txs?.length>2){
    const ts=h.txs.map(t=>t.timestamp).filter(Boolean).sort();
    if(ts.length>2){const gaps=[];for(let i=1;i<ts.length;i++)gaps.push(Math.abs(ts[i]-ts[i-1]));
      const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length;
      if(avg<5){lb="Sniper Bot";rs+=35;fl.push({s:"c",t:"<5s TX gaps — bot"})}
      else if(avg<20){if(lb==="Holder")lb="Fast Trader";rs+=10;fl.push({s:"w",t:"Rapid TX pattern"})}
    }
    const sw=h.txs.filter(t=>t.type==="SWAP").length;
    if(sw>12){if(lb==="Holder")lb="Active Trader";fl.push({s:"i",t:`${sw} swaps — very active`})}
  }

  if(h.owner?.startsWith("1111")){lb="Burn";rs=0;fl.length=0;fl.push({s:"g",t:"Burn address"})}
  if(!fl.length)fl.push({s:"g",t:"No anomalies"});
  return{lb,rs:Math.min(rs,100),fl};
}

function computeRugDNA(holders, sec){
  const t10=holders.slice(0,10).reduce((s,h)=>s+h.pct,0);
  const t5=holders.slice(0,5).reduce((s,h)=>s+h.pct,0);
  let sc=0;const f=[];
  if(t10>70){sc+=35;f.push({s:"c",t:`Top 10 control ${t10.toFixed(1)}% — extreme`})}
  else if(t10>50){sc+=20;f.push({s:"w",t:`Top 10 control ${t10.toFixed(1)}%`})}
  else f.push({s:"g",t:`Top 10 hold ${t10.toFixed(1)}%`});
  if(t5>50){sc+=15;f.push({s:"c",t:`Top 5 hold ${t5.toFixed(1)}%`})}
  const wh=holders.filter(h=>h.pct>5).length;
  if(wh>3){sc+=15;f.push({s:"w",t:`${wh} wallets >5% each`})}
  const dumpers=holders.filter(h=>h.lb==="Dumper").length;
  if(dumpers>2){sc+=15;f.push({s:"c",t:`${dumpers} dumper wallets detected`})}
  const bots=holders.filter(h=>h.lb==="Sniper Bot").length;
  if(bots>1){sc+=10;f.push({s:"w",t:`${bots} sniper bots`})}
  const diamonds=holders.filter(h=>h.pnlData&&h.pnlData.buyCount>0&&h.pnlData.sellCount===0).length;
  if(diamonds>holders.length*0.3&&diamonds>2)f.push({s:"g",t:`${diamonds} diamond hands holders`});
  const profitable=holders.filter(h=>h.pnlData?.pnlSol>0).length;
  const losing=holders.filter(h=>h.pnlData?.pnlSol!=null&&h.pnlData.pnlSol<0).length;
  if(profitable>0||losing>0)f.push({s:"i",t:`${profitable} profitable, ${losing} losing among analyzed`});
  if(sec){
    if(sec.isMintable){sc+=25;f.push({s:"c",t:"MINTABLE"})}
    if(sec.isFreezable){sc+=20;f.push({s:"c",t:"FREEZABLE"})}
    if(!sec.isMintable&&!sec.isFreezable)f.push({s:"g",t:"Not mintable/freezable"});
  }
  if(sc<=10)f.unshift({s:"g",t:"No major red flags"});
  sc=Math.min(sc,100);
  return{sc,lv:sc>60?"HIGH RISK":sc>30?"MEDIUM":"LOW RISK",f,
    st:{t10,t5,wh,bots,dumpers,profitable,losing,n:holders.length,mint:sec?.isMintable||false,freeze:sec?.isFreezable||false}};
}

// ─── UTILS ──────────────────────────────────────────────
const tr=(a,n=4)=>a?`${a.slice(0,n)}...${a.slice(-n)}`:"—";
const ago=ts=>{if(!ts)return"—";const s=Math.floor(Date.now()/1000-ts);if(s<0)return"now";if(s<60)return s+"s";if(s<3600)return Math.floor(s/60)+"m";if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d"};
const $=n=>{if(!n&&n!==0)return"—";const a=Math.abs(n);if(a>=1e9)return`$${(n/1e9).toFixed(2)}B`;if(a>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(a>=1e3)return`$${(n/1e3).toFixed(1)}K`;return`$${parseFloat(n).toFixed(2)}`};
const pf=n=>n!=null?`${n>=0?"+":""}${parseFloat(n).toFixed(2)}%`:"—";
const fp=n=>{if(!n)return"—";if(n<1e-5)return`$${parseFloat(n).toExponential(2)}`;if(n<0.01)return`$${parseFloat(n).toFixed(6)}`;if(n<1)return`$${parseFloat(n).toFixed(4)}`;return`$${parseFloat(n).toFixed(2)}`};
const solStr=(n,short)=>{if(n==null)return"—";const s=n>=0?"+":"";if(short&&Math.abs(n)<0.001)return"~0";return`${s}${n.toFixed(3)}`};

// ─── UI ─────────────────────────────────────────────────
const B=({text,color=C.g})=><span style={{display:"inline-block",padding:"2px 6px",fontSize:8.5,fontWeight:700,color,background:`${color}15`,border:`1px solid ${color}30`,borderRadius:3,letterSpacing:1,textTransform:"uppercase",fontFamily:"inherit",whiteSpace:"nowrap"}}>{text}</span>;
const Dot=({color=C.g,label="LIVE"})=><span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color,letterSpacing:1.5}}><span style={{width:6,height:6,borderRadius:"50%",background:color,boxShadow:`0 0 8px ${color}`,animation:"pulse 2s ease-in-out infinite"}}/>{label}</span>;
const RBar=({score})=>{const co=score>60?C.r:score>30?C.y:C.g;return<div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:90,height:5,background:`${C.tM}33`,borderRadius:3,overflow:"hidden"}}><div style={{width:`${Math.min(score,100)}%`,height:"100%",borderRadius:3,background:`linear-gradient(90deg,${C.g},${score>30?C.y:C.g},${score>60?C.r:C.y})`,transition:"width 0.6s"}}/></div><span style={{fontSize:12,fontWeight:700,color:co}}>{score}/100</span></div>};
const St=({l,v,color=C.t,sm})=><div style={{textAlign:"center"}}><div style={{fontSize:sm?13:17,fontWeight:700,color}}>{v}</div><div style={{fontSize:8,color:C.tM,letterSpacing:1.5,marginTop:2}}>{l}</div></div>;
const KV=({k,v,color=C.t})=><div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:11}}><span style={{color:C.tS}}>{k}</span><span style={{color}}>{v}</span></div>;
const Ld=({text})=><div style={{textAlign:"center",padding:50}}><div style={{display:"inline-flex",gap:3,marginBottom:14}}>{[0,1,2,3,4,5,6].map(i=><div key={i} style={{width:3,height:20,background:C.g,borderRadius:1,animation:`pulse 0.8s ease ${i*0.1}s infinite`,boxShadow:`0 0 6px ${C.gG}`}}/>)}</div><div style={{fontSize:11,color:C.g,letterSpacing:3}}>{text}</div></div>;
const fc=s=>s==="c"?C.r:s==="w"?C.y:s==="g"?C.g:C.c;
const fi=s=>s==="c"?"✖":s==="w"?"⚠":"✓";
const spin=<span style={{display:"inline-block",width:8,height:8,border:`2px solid ${C.tM}`,borderTopColor:C.g,borderRadius:"50%",animation:"spin 0.6s linear infinite"}}/>;

// ─── WALLET ROW ─────────────────────────────────────────
function WRow({h,exp,onTog,onW,sym,price}){
  const rc=h.rs>60?C.r:h.rs>30?C.y:C.g;
  const lc=h.lb==="Sniper Bot"||h.lb==="Dumper"?C.r:h.lb==="Whale"?C.o:h.lb==="Flipper"?C.p:h.lb.includes("Trader")?C.y:h.lb==="Burn"?C.tM:C.c;
  const pnl=h.pnlData;
  const loading=h.enriching;
  const pnlSol=pnl?.pnlSol;
  const pnlUsd=pnlSol!=null&&price?pnlSol*price:null; // approximate USD PnL
  const holdVal=h.amt&&price?h.amt*price:null;

  return<div style={{background:exp?C.bgH:C.bgC,border:`1px solid ${exp?C.bdH:C.bd}`,borderRadius:5,marginBottom:3,cursor:"pointer"}}>
    <div onClick={onTog} style={{display:"grid",gridTemplateColumns:"30px 1.4fr 0.5fr 0.45fr 0.65fr 0.45fr 0.45fr 0.55fr 42px",alignItems:"center",padding:"7px 10px",gap:3}}>
      <span style={{fontSize:10,color:C.tM}}>#{h.rank}</span>
      <div style={{display:"flex",alignItems:"center",gap:4,overflow:"hidden"}}><span style={{fontSize:11,color:C.t}}>{tr(h.owner,5)}</span><B text={h.lb} color={lc}/></div>
      <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{h.pct.toFixed(2)}%</span>
      <span style={{fontSize:11,color:rc,textAlign:"right"}}>{h.rs}</span>
      <div style={{textAlign:"right"}}>
        {loading?spin:pnlSol!=null?<div>
          <div style={{fontSize:11,color:pnlSol>=0?C.g:C.r,fontWeight:600}}>{solStr(pnlSol)} SOL</div>
          {pnlUsd!=null&&<div style={{fontSize:9,color:C.tM}}>{pnlUsd>=0?"+":""}${Math.abs(pnlUsd).toFixed(0)}</div>}
        </div>:<span style={{fontSize:11,color:C.tM}}>—</span>}
      </div>
      <span style={{fontSize:11,textAlign:"right",color:pnl?.winRate!=null?(pnl.winRate>=50?C.g:C.r):C.tM}}>{loading?spin:pnl?.winRate!=null?`${pnl.winRate.toFixed(0)}%`:"—"}</span>
      <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{loading?spin:pnl?.avgHold!=null?pnl.avgHold<1?`${(pnl.avgHold*60).toFixed(0)}m`:`${pnl.avgHold.toFixed(1)}h`:"—"}</span>
      <div style={{textAlign:"right"}}>{holdVal!=null&&<div style={{fontSize:9,color:C.tM}}>{$(holdVal)}</div>}</div>
      <button onClick={e=>{e.stopPropagation();onW(h)}} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.tS,cursor:"pointer",padding:"2px 4px",fontSize:8,fontFamily:"inherit"}}
        onMouseEnter={e=>{e.target.style.borderColor=C.g;e.target.style.color=C.g}} onMouseLeave={e=>{e.target.style.borderColor=C.bd;e.target.style.color=C.tS}}>+W</button>
    </div>
    {exp&&<div style={{padding:"0 10px 12px",borderTop:`1px solid ${C.bd}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,animation:"fadeIn 0.2s"}}>
      <div style={{paddingTop:10}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:6}}>WALLET</div>
        <KV k="Address" v={tr(h.owner,10)}/><KV k="SOL" v={h.sol!=null?`${h.sol.toFixed(3)} SOL`:"..."} color={h.sol!=null?C.t:C.tM}/>
        <KV k="Holding" v={`${h.amt?.toLocaleString(undefined,{maximumFractionDigits:0})} ${sym}`}/>
        <KV k="Value" v={holdVal!=null?$(holdVal):"—"}/><KV k="% Supply" v={`${h.pct.toFixed(4)}%`}/>
        {pnl&&pnl.totalTrades>0&&<>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>TRADE INTEL</div>
          <KV k="PnL (SOL)" v={pnlSol!=null?`${solStr(pnlSol)} SOL`:"—"} color={pnlSol!=null?(pnlSol>=0?C.g:C.r):C.tM}/>
          {pnlUsd!=null&&<KV k="PnL (USD)" v={`${pnlUsd>=0?"+":""}$${Math.abs(pnlUsd).toFixed(2)}`} color={pnlUsd>=0?C.g:C.r}/>}
          <KV k="Win Rate" v={pnl.winRate!=null?`${pnl.winRate.toFixed(1)}%`:"—"} color={pnl.winRate>=50?C.g:C.r}/>
          <KV k="Buys" v={pnl.buyCount} color={C.g}/><KV k="Sells" v={pnl.sellCount} color={pnl.sellCount>0?C.r:C.t}/>
          <KV k="SOL Spent" v={pnl.solSpent>0?`${pnl.solSpent.toFixed(3)} SOL`:"—"}/>
          <KV k="SOL Received" v={pnl.solReceived>0?`${pnl.solReceived.toFixed(3)} SOL`:"—"}/>
          <KV k="Avg Hold" v={pnl.avgHold!=null?pnl.avgHold<1?`${(pnl.avgHold*60).toFixed(0)} min`:`${pnl.avgHold.toFixed(1)}h`:"—"}/>
          <KV k="First Buy" v={pnl.firstBuy?`${ago(pnl.firstBuy)} ago`:"—"}/>
        </>}
        {pnl&&pnl.trades?.length>0&&<>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>TRADE LOG</div>
          {pnl.trades.slice(0,6).map((t,i)=><div key={i} style={{display:"flex",gap:6,fontSize:10,marginBottom:2,alignItems:"center"}}>
            <B text={t.type} color={t.type==="BUY"?C.g:C.r}/>
            <span style={{color:C.tS}}>{t.token?.toLocaleString(undefined,{maximumFractionDigits:0})} {sym}</span>
            <span style={{color:C.t}}>{t.sol?.toFixed(3)} SOL</span>
            <span style={{color:C.tM}}>{ago(t.ts)}</span>
          </div>)}
        </>}
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>FLAGS</div>
        {h.fl.map((f,i)=><div key={i} style={{display:"flex",gap:4,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
      </div>
      <div style={{paddingTop:10}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:6}}>RECENT TXS</div>
        {(!h.txs||!h.txs.length)&&<div style={{fontSize:10,color:C.tM,padding:8}}>Loading...</div>}
        {(h.txs||[]).slice(0,10).map((tx,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 5px",marginBottom:2,borderRadius:3,background:`${C.bg}88`,fontSize:9.5,gap:4}}>
          <B text={tx.type||"TX"} color={tx.type==="SWAP"?C.c:tx.type==="TRANSFER"?C.y:tx.type?.includes("NFT")?C.p:C.tS}/>
          <span style={{color:C.tS,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginLeft:3}}>{tx.description?.slice(0,40)||tr(tx.signature,6)}</span>
          <span style={{color:C.tM,flexShrink:0}}>{ago(tx.timestamp)}</span>
        </div>)}
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:12,marginBottom:4}}>LINKS</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {[["Solscan",`https://solscan.io/account/${h.owner}`],["Birdeye",`https://birdeye.so/profile/${h.owner}?chain=solana`],["SolanaFM",`https://solana.fm/address/${h.owner}`]].map(([n,u])=>
            <a key={n} href={u} target="_blank" rel="noopener noreferrer" style={{padding:"2px 7px",borderRadius:3,fontSize:9,color:C.g,background:C.gD,border:`1px solid ${C.g}30`,fontFamily:"inherit"}}>{n}↗</a>)}
        </div>
      </div>
    </div>}
  </div>;
}

function RDP({rd}){if(!rd)return null;const lc=rd.lv==="HIGH RISK"?C.r:rd.lv==="MEDIUM"?C.y:C.g;
  return<div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,padding:14,marginBottom:10}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:12,fontWeight:700,letterSpacing:1.5}}>RUG DNA</span><B text={rd.lv} color={lc}/></div>
      <RBar score={rd.sc}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:4,marginBottom:10,padding:"8px 0",borderTop:`1px solid ${C.bd}`,borderBottom:`1px solid ${C.bd}`}}>
      <St l="TOP 10%" v={`${rd.st.t10.toFixed(1)}%`} color={rd.st.t10>50?C.r:C.t} sm/>
      <St l="TOP 5%" v={`${rd.st.t5.toFixed(1)}%`} color={rd.st.t5>40?C.r:C.t} sm/>
      <St l="WHALES" v={rd.st.wh} color={rd.st.wh>3?C.o:C.t} sm/>
      <St l="BOTS" v={rd.st.bots} color={rd.st.bots>1?C.r:C.t} sm/>
      <St l="DUMPERS" v={rd.st.dumpers} color={rd.st.dumpers>1?C.r:C.t} sm/>
      <St l="PROFIT" v={rd.st.profitable} color={C.g} sm/>
      <St l="LOSING" v={rd.st.losing} color={rd.st.losing>5?C.r:C.t} sm/>
      <St l="MINTABLE" v={rd.st.mint?"YES":"NO"} color={rd.st.mint?C.r:C.g} sm/>
      <St l="FREEZABLE" v={rd.st.freeze?"YES":"NO"} color={rd.st.freeze?C.r:C.g} sm/>
    </div>
    {rd.f.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
  </div>;
}

function TH({m}){if(!m)return null;const ch=m.priceChange24hPercent||0;
  return<div style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",gap:8,marginBottom:10,padding:12,background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,alignItems:"center"}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>{m.logoURI&&<img src={m.logoURI} alt="" style={{width:26,height:26,borderRadius:"50%",border:`1px solid ${C.bd}`}}/>}<div><div style={{fontSize:13,fontWeight:700}}>{m.symbol||"—"}</div><div style={{fontSize:9,color:C.tM}}>{m.name}</div></div></div>
    <St l="PRICE" v={fp(m.price)}/><St l="MCAP" v={$(m.mc||m.marketCap)}/><St l="24H VOL" v={$(m.v24hUSD)}/><St l="LIQUIDITY" v={$(m.liquidity)}/><St l="24H" v={pf(ch)} color={ch>=0?C.g:C.r}/>
  </div>;
}

// ─── VALIDATE ───────────────────────────────────────────
function VTab(){const[addr,sA]=useState("");const[ld,sL]=useState(false);const[d,sD]=useState(null);const[err,sE]=useState("");
  const scan=async()=>{if(!addr.trim())return;sL(true);sE("");sD(null);
    try{const[bal,txs,port]=await Promise.all([getSolBal(addr),getTxs(addr),getPortfolio(addr)]);
      const tok=(port||[]).filter(t=>t.valueUsd>0.01).sort((a,b)=>(b.valueUsd||0)-(a.valueUsd||0));
      const tv=tok.reduce((s,t)=>s+(t.valueUsd||0),0);
      const gen=parseGeneralPnL(txs,addr);
      let rs=0;const fl=[];
      if(bal<0.01){rs+=15;fl.push({s:"w",t:"Low SOL"})}
      if(!(txs||[]).length){rs+=20;fl.push({s:"w",t:"No TX history"})}
      if(tok.length>100)fl.push({s:"i",t:`${tok.length} tokens`});
      if(gen.swaps>15)fl.push({s:"i",t:`${gen.swaps} swaps — active`});
      if(!fl.length)fl.push({s:"g",t:"No anomalies"});
      sD({addr,bal,txs:txs||[],tok,tv,rs:Math.min(rs,100),fl,gen});
    }catch(e){sE(e.message)}sL(false)};
  return<div>
    <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:3}}>VALIDATE WALLET</div>
    <div style={{fontSize:10.5,color:C.tS,marginBottom:14}}>Wallet → balance → portfolio → trade history → risk</div>
    <div style={{display:"flex",gap:8,marginBottom:20}}>
      <input value={addr} onChange={e=>sA(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="Paste wallet address..."
        style={{flex:1,padding:"11px 14px",background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,color:C.t,fontFamily:"inherit",fontSize:12,outline:"none"}}
        onFocus={e=>e.target.style.borderColor=C.g} onBlur={e=>e.target.style.borderColor=C.bd}/>
      <button onClick={scan} disabled={ld} style={{padding:"11px 24px",background:"transparent",border:`1px solid ${C.g}`,borderRadius:5,color:C.g,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:ld?"wait":"pointer",letterSpacing:2}}>{ld?"SCANNING...":"DEEP SCAN"}</button>
    </div>
    {err&&<div style={{color:C.r,fontSize:11,marginBottom:10,padding:"8px 12px",background:C.rD,borderRadius:4}}>{err}</div>}
    {ld&&<Ld text="DEEP SCANNING..."/>}
    {d&&!ld&&<div style={{animation:"fadeIn 0.3s"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
        {[["RISK",d.rs,d.rs>60?C.r:d.rs>30?C.y:C.g],["SOL",d.bal.toFixed(3),C.t],["PORTFOLIO",$(d.tv),C.t],["TOKENS",d.tok.length,C.t],["SWAPS",d.gen.swaps,C.c]].map(([l,v,c])=>
          <div key={l} style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:11,textAlign:"center"}}><div style={{fontSize:17,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:8,color:C.tM,letterSpacing:1.5,marginTop:3}}>{l}</div></div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>FLAGS</div>
          {d.fl.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
        </div>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>TX TYPES</div>
          {Object.entries(d.gen.types).sort((a,b)=>b[1]-a[1]).map(([t,c])=><KV key={t} k={t} v={c}/>)}
        </div>
      </div>
      <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>HOLDINGS ({d.tok.length})</div>
        {d.tok.slice(0,20).map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 6px",borderRadius:3,background:i%2?`${C.bg}55`:"transparent",fontSize:10.5}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>{t.logoURI&&<img src={t.logoURI} alt="" style={{width:15,height:15,borderRadius:"50%"}}/>}<span style={{color:C.t,fontWeight:600}}>{t.symbol||"?"}</span></div>
          <span style={{color:C.tS}}>{parseFloat(t.uiAmount||0).toLocaleString(undefined,{maximumFractionDigits:1})}</span>
          <span style={{color:C.t}}>{$(t.valueUsd)}</span><span style={{color:C.tS}}>{fp(t.priceUsd)}</span>
        </div>)}
      </div>
    </div>}
  </div>;
}

function WL({wl,onRm,price}){
  if(!wl.length)return<div style={{textAlign:"center",padding:60}}><div style={{fontSize:30,marginBottom:10,opacity:.25}}>👁</div><div style={{fontSize:12,color:C.tS}}>No wallets watched</div></div>;
  return<div><div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:10}}>WATCHED — {wl.length}</div>
    {wl.map((w,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"1.3fr 0.35fr 0.4fr 0.5fr 0.4fr 0.4fr 36px",alignItems:"center",padding:"8px 10px",gap:4,background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,marginBottom:3}}>
      <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,color:C.t}}>{tr(w.owner,6)}</span><B text={w.lb} color={C.c}/></div>
      <span style={{fontSize:11,color:w.rs>60?C.r:C.g,textAlign:"right"}}>{w.rs}</span>
      <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{w.pct.toFixed(2)}%</span>
      <span style={{fontSize:11,textAlign:"right",color:w.pnlData?.pnlSol>=0?C.g:C.r}}>{w.pnlData?.pnlSol!=null?`${solStr(w.pnlData.pnlSol)} SOL`:"—"}</span>
      <span style={{fontSize:11,textAlign:"right",color:C.tS}}>{w.pnlData?.winRate!=null?`${w.pnlData.winRate.toFixed(0)}%`:"—"}</span>
      <span style={{fontSize:10,color:C.tS,textAlign:"right"}}>{w.amt?.toLocaleString(undefined,{maximumFractionDigits:0})||"—"}</span>
      <button onClick={()=>onRm(i)} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.r,cursor:"pointer",padding:"2px 4px",fontSize:8,fontFamily:"inherit"}}>X</button>
    </div>)}
  </div>;
}

// ═══════════════════════════════════════════════════════════
export default function Signal(){
  const[tab,setTab]=useState("discover");const[ca,setCa]=useState("");const[ld,setLd]=useState(false);
  const[hl,setHl]=useState([]);const[rd,setRd]=useState(null);const[tm,setTm]=useState(null);
  const[exp,setExp]=useState(null);const[wl,setWl]=useState([]);
  const[sort,setSort]=useState("rank");const[filt,setFilt]=useState("ALL");
  const[msg,setMsg]=useState("");const[err,setErr]=useState("");
  const[enriched,setEnriched]=useState(0);const[enrichTotal,setEnrichTotal]=useState(0);
  const hlRef=useRef([]);

  const enrichWallet=async(idx,holders,mint)=>{
    const h=holders[idx];if(!h)return holders;
    try{
      const[bal,txs]=await Promise.all([getSolBal(h.owner),getTxs(h.owner)]);
      holders[idx]={...holders[idx],sol:bal,txs:txs||[],enriching:false};
      holders[idx].pnlData=parseTxPnL(txs||[],mint,h.owner);
      const rc=classify(holders[idx],holders);
      holders[idx].lb=rc.lb;holders[idx].rs=rc.rs;holders[idx].fl=rc.fl;
    }catch{holders[idx].enriching=false}
    return holders;
  };

  const discover=async()=>{
    if(!ca.trim())return;setLd(true);setErr("");setHl([]);setRd(null);setTm(null);setExp(null);setEnriched(0);
    try{
      setMsg("Token overview...");
      const[ov,sec]=await Promise.all([getOverview(ca),getSecurity(ca)]);
      if(ov)setTm(ov);
      setMsg("Fetching holders...");
      const raw=await getHolders(ca);
      if(!raw?.length){setErr("No holders — check mint");setLd(false);return}
      const tot=raw.reduce((s,h)=>s+h.amt,0);
      let holders=raw.map((h,i)=>({...h,rank:i+1,pct:tot>0?(h.amt/tot)*100:0,txs:[],sol:null,pnlData:null,enriching:true,fl:[],lb:"Holder",rs:0}));
      // Initial classify without TX data
      for(const h of holders){const c=classify(h,holders);h.lb=c.lb;h.rs=c.rs;h.fl=c.fl}
      setHl([...holders]);
      setRd(computeRugDNA(holders,sec));
      setLd(false);

      // Enrich ALL wallets in parallel batches of 5
      const total=holders.length;setEnrichTotal(total);
      for(let batch=0;batch<total;batch+=5){
        const promises=[];
        for(let i=batch;i<Math.min(batch+5,total);i++){
          promises.push(enrichWallet(i,holders,ca));
        }
        await Promise.all(promises);
        setEnriched(Math.min(batch+5,total));
        setHl([...holders]);
        // Recompute rug DNA with updated data
        setRd(computeRugDNA(holders,sec));
      }
      // Mark all done
      for(const h of holders)h.enriching=false;
      setHl([...holders]);setEnrichTotal(0);
    }catch(e){setErr(e.message);setLd(false)}
  };

  const toggle=owner=>{if(exp===owner)setExp(null);else setExp(owner)};

  const sorted=[...hl].sort((a,b)=>{
    if(sort==="rank")return a.rank-b.rank;
    if(sort==="risk")return b.rs-a.rs;
    if(sort==="pnl")return(b.pnlData?.pnlSol||0)-(a.pnlData?.pnlSol||0);
    return b.pct-a.pct;
  }).filter(h=>filt==="ALL"||h.lb===filt);
  const labels=["ALL",...new Set(hl.map(h=>h.lb))];
  const solPrice=150; // approximate for USD display
  const tokenPrice=tm?.price||0;

  return<div style={{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"'JetBrains Mono','Fira Code',monospace"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes glow{0%,100%{box-shadow:0 0 8px ${C.gG}}50%{box-shadow:0 0 20px ${C.gG}}}@keyframes spin{to{transform:rotate(360deg)}}
      ::selection{background:${C.g}25;color:${C.g}}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.bd};border-radius:3px}input::placeholder{color:${C.tM}}a{text-decoration:none}`}</style>
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:90,background:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,255,136,0.004) 3px,rgba(0,255,136,0.004) 4px)"}}/>

    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 22px",borderBottom:`1px solid ${C.bd}`,background:`${C.bgS}dd`,backdropFilter:"blur(10px)",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:3,height:24,background:C.g,borderRadius:1,boxShadow:`0 0 10px ${C.gG}`,animation:"glow 3s ease infinite"}}/>
        <div><div style={{fontSize:16,fontWeight:800,letterSpacing:7}}>SIGNAL</div><div style={{fontSize:8,letterSpacing:3,color:C.g,marginTop:-2}}>WALLET DISCOVERY ENGINE</div></div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:C.tS,letterSpacing:2}}>HELIUS</a>
        <a href="https://birdeye.so" target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:C.tS,letterSpacing:2}}>BIRDEYE</a>
        <Dot/>
        {enrichTotal>0&&<Dot color={C.y} label={`${enriched}/${enrichTotal}`}/>}
      </div>
    </header>

    <main style={{maxWidth:1500,margin:"0 auto",padding:"16px 22px"}}>
      <div style={{display:"flex",gap:3,marginBottom:20}}>
        {[{id:"discover",l:"DISCOVER",s:"Token → Wallets + PnL"},{id:"validate",l:"VALIDATE",s:"Wallet → Deep State"},{id:"watchlist",l:"WATCHLIST",s:`${wl.length} saved`}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 24px",background:tab===t.id?C.bgH:"transparent",border:`1px solid ${tab===t.id?C.g:C.bd}`,borderRadius:5,cursor:"pointer",textAlign:"center",fontFamily:"inherit"}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:tab===t.id?C.g:C.tS}}>{t.l}</div>
            <div style={{fontSize:8,color:tab===t.id?C.gM:C.tM,marginTop:1,letterSpacing:1}}>{t.s}</div>
          </button>)}
      </div>

      {tab==="discover"&&<div style={{animation:"fadeIn 0.2s"}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:3}}>DISCOVER WALLETS</div>
        <div style={{fontSize:10.5,color:C.tS,marginBottom:12}}>Token CA → holders → PnL → win rate → avg hold → risk → rug DNA</div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={ca} onChange={e=>setCa(e.target.value)} onKeyDown={e=>e.key==="Enter"&&discover()} placeholder="Paste Solana token mint address..."
            style={{flex:1,padding:"11px 14px",background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,color:C.t,fontFamily:"inherit",fontSize:12,outline:"none"}}
            onFocus={e=>e.target.style.borderColor=C.g} onBlur={e=>e.target.style.borderColor=C.bd}/>
          <button onClick={discover} disabled={ld} style={{padding:"11px 24px",background:"transparent",border:`1px solid ${C.g}`,borderRadius:5,color:C.g,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:ld?"wait":"pointer",letterSpacing:2,minWidth:155}}>
            {ld?"SCANNING...":"FIND WALLETS"}</button>
        </div>
        {err&&<div style={{color:C.r,fontSize:11,marginBottom:10,padding:"8px 12px",background:C.rD,borderRadius:4}}>{err}</div>}
        {ld&&<Ld text={msg||"SCANNING..."}/>}
        {!ld&&hl.length>0&&<div style={{animation:"fadeIn 0.3s"}}>
          <TH m={tm}/>
          <RDP rd={rd}/>
          {enrichTotal>0&&<div style={{fontSize:10,color:C.y,marginBottom:8,letterSpacing:1}}>⟳ Enriching wallets: {enriched}/{enrichTotal} — PnL data populating live...</div>}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5,padding:"5px 0",flexWrap:"wrap",gap:6}}>
            <div style={{display:"flex",gap:3,alignItems:"center"}}>
              <span style={{fontSize:9,color:C.tM,letterSpacing:2,marginRight:4}}>SORT</span>
              {[["rank","RANK"],["risk","RISK↓"],["pnl","PnL↓"],["pct","HOLD%↓"]].map(([k,l])=>
                <button key={k} onClick={()=>setSort(k)} style={{padding:"2px 7px",fontSize:9,fontFamily:"inherit",background:sort===k?C.gD:"transparent",border:`1px solid ${sort===k?C.g:C.bd}`,color:sort===k?C.g:C.tS,borderRadius:3,cursor:"pointer"}}>{l}</button>)}
            </div>
            <div style={{display:"flex",gap:2,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:9,color:C.tM,letterSpacing:2,marginRight:4}}>FILTER</span>
              {labels.map(l=><button key={l} onClick={()=>setFilt(l)} style={{padding:"2px 6px",fontSize:8,fontFamily:"inherit",background:filt===l?C.cD:"transparent",border:`1px solid ${filt===l?C.c:C.bd}`,color:filt===l?C.c:C.tS,borderRadius:3,cursor:"pointer"}}>{l}</button>)}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"30px 1.4fr 0.5fr 0.45fr 0.65fr 0.45fr 0.45fr 0.55fr 42px",padding:"5px 10px",gap:3,fontSize:8,color:C.tM,letterSpacing:1.2,borderBottom:`1px solid ${C.bd}`,marginBottom:3}}>
            <span>#</span><span>WALLET</span><span style={{textAlign:"right"}}>HOLD%</span><span style={{textAlign:"right"}}>RISK</span><span style={{textAlign:"right"}}>PnL (SOL)</span><span style={{textAlign:"right"}}>WIN%</span><span style={{textAlign:"right"}}>AVG HOLD</span><span style={{textAlign:"right"}}>VALUE</span><span></span>
          </div>
          {sorted.map(h=><WRow key={h.tAcc} h={h} sym={tm?.symbol||""} price={tokenPrice} exp={exp===h.owner} onTog={()=>toggle(h.owner)} onW={w=>{if(!wl.find(x=>x.owner===w.owner))setWl([...wl,w])}}/>)}
          <div style={{textAlign:"center",padding:12,fontSize:9,color:C.tM,letterSpacing:2}}>
            {sorted.length} WALLETS • {hl.filter(h=>h.pnlData?.pnlSol!=null).length} WITH PnL • {hl.filter(h=>h.pnlData?.pnlSol>0).length} PROFITABLE • {hl.filter(h=>h.rs>50).length} FLAGGED
          </div>
        </div>}
        {!ld&&!hl.length&&!err&&<div style={{textAlign:"center",padding:60}}><div style={{fontSize:36,opacity:.2,marginBottom:12}}>⚡</div><div style={{fontSize:11,color:C.tS,letterSpacing:2}}>PASTE A TOKEN MINT TO BEGIN</div></div>}
      </div>}
      {tab==="validate"&&<div style={{animation:"fadeIn 0.2s"}}><VTab/></div>}
      {tab==="watchlist"&&<div style={{animation:"fadeIn 0.2s"}}><WL wl={wl} onRm={i=>setWl(wl.filter((_,x)=>x!==i))} price={tokenPrice}/></div>}
    </main>
    <footer style={{padding:"12px 22px",borderTop:`1px solid ${C.bd}`,display:"flex",justifyContent:"space-between",marginTop:20}}>
      <span style={{fontSize:9,color:C.tM,letterSpacing:2}}>SIGNAL v3.2 — PnL from TX parsing</span>
      <span style={{fontSize:9,color:C.tM}}>Helius enhanced TXs + Birdeye</span>
    </footer>
  </div>;
}
