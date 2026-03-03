import { useState, useCallback, useRef } from "react";

const HK="efb053d6-f7c7-4c90-9bc5-0ce3af9c59df";
const BK="94ba9de0953642878038f5a7eccc1114";
const RPC=`https://mainnet.helius-rpc.com/?api-key=${HK}`;
const HAPI=`https://api.helius.xyz/v0`;
const BAPI=`https://public-api.birdeye.so`;
const C={bg:"#05070b",bgS:"#0a0e17",bgC:"#0d1219",bgH:"#121a27",bd:"#161f30",bdH:"#1e3a2a",g:"#00ff88",gD:"#00ff8820",gM:"#00cc6a",gG:"#00ff8840",r:"#ff2e4c",rD:"#ff2e4c18",y:"#ffc800",yD:"#ffc80018",c:"#00cfff",cD:"#00cfff18",p:"#b44dff",o:"#ff8c00",t:"#dfe6f0",tS:"#5a6e8a",tM:"#2d3d56"};

async function rpcCall(m,p){try{const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});return(await r.json()).result||null}catch{return null}}
async function bGet(ep,params={}){try{const u=new URL(`${BAPI}${ep}`);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{headers:{"X-API-KEY":BK,"x-chain":"solana"}});if(!r.ok)return null;return await r.json()}catch{return null}}
async function getOverview(a){return(await bGet("/defi/token_overview",{address:a}))?.data||null}
async function getSecurity(a){return(await bGet("/defi/token_security",{address:a}))?.data||null}
async function getHolders(mint){
  const lg=await rpcCall("getTokenLargestAccounts",[mint]);
  if(!lg?.value)return[];
  return Promise.all(lg.value.slice(0,20).map(ac=>
    rpcCall("getAccountInfo",[ac.address,{encoding:"jsonParsed"}]).then(info=>{
      const p=info?.value?.data?.parsed?.info;
      return p?{tAcc:ac.address,owner:p.owner,amt:parseFloat(p.tokenAmount?.uiAmountString||"0")}
              :{tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0")};
    }).catch(()=>({tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0")}))
  ));
}
async function getSolBal(a){const r=await rpcCall("getBalance",[a]);return r?r/1e9:0}
async function getTxs(a){try{return await(await fetch(`${HAPI}/addresses/${a}/transactions?api-key=${HK}&limit=30`)).json()}catch{return[]}}
async function getPortfolio(a){return(await bGet("/v1/wallet/token_list",{wallet:a}))?.data?.items||[]}

// ─── PnL CALCULATION ────────────────────────────────────
// Strategy: Parse Helius enhanced TXs. For swaps, look at ALL tokenTransfers
// to figure out what went in/out. Use the OTHER token in the swap pair
// (usually SOL/USDC/USDT) to determine value.
const SOL_MINT="So11111111111111111111111111111111111111112";
const USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT="Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLES=new Set([USDC_MINT,USDT_MINT]);

function parseTxPnL(txs, tokenMint, walletAddr){
  let totalValueIn=0; // value spent to buy (in USD approx)
  let totalValueOut=0; // value received from sells (in USD approx)
  let tokenBought=0, tokenSold=0;
  let buyCount=0, sellCount=0;
  let firstBuy=null, lastTx=null;
  const trades=[];

  for(const tx of (txs||[])){
    const xfers=tx.tokenTransfers||[];
    if(!xfers.length)continue;
    lastTx=tx.timestamp;

    // Find our target token transfers
    const tokIn=xfers.filter(x=>x.mint===tokenMint&&(x.toUserAccount===walletAddr));
    const tokOut=xfers.filter(x=>x.mint===tokenMint&&(x.fromUserAccount===walletAddr));
    
    // Find value token transfers (SOL wrapped, USDC, USDT)
    const valIn=xfers.filter(x=>(x.mint===SOL_MINT||STABLES.has(x.mint))&&x.toUserAccount===walletAddr);
    const valOut=xfers.filter(x=>(x.mint===SOL_MINT||STABLES.has(x.mint))&&x.fromUserAccount===walletAddr);
    
    // Also check nativeTransfers for unwrapped SOL
    const natIn=(tx.nativeTransfers||[]).filter(n=>n.toUserAccount===walletAddr&&Math.abs(n.amount)>10000);
    const natOut=(tx.nativeTransfers||[]).filter(n=>n.fromUserAccount===walletAddr&&Math.abs(n.amount)>10000);
    
    if(tokIn.length>0){
      // BUY: wallet received target token
      const tokAmt=tokIn.reduce((s,x)=>s+Math.abs(parseFloat(x.tokenAmount||0)),0);
      // Value paid: either wrapped SOL/USDC sent, or native SOL sent
      let valPaid=valOut.reduce((s,x)=>{
        const amt=Math.abs(parseFloat(x.tokenAmount||0));
        return s+(x.mint===SOL_MINT?amt*150:amt); // rough SOL→USD
      },0);
      // Add native SOL out (for direct SOL→token swaps)
      valPaid+=natOut.reduce((s,n)=>s+Math.abs(n.amount)/1e9*150,0);
      // Subtract fees/rent (small amounts)
      if(valPaid>0&&tokAmt>0){
        buyCount++;tokenBought+=tokAmt;totalValueIn+=valPaid;
        if(!firstBuy)firstBuy=tx.timestamp;
        trades.push({type:"BUY",token:tokAmt,usd:valPaid,ts:tx.timestamp,sig:tx.signature});
      }
    }
    
    if(tokOut.length>0){
      // SELL: wallet sent target token
      const tokAmt=tokOut.reduce((s,x)=>s+Math.abs(parseFloat(x.tokenAmount||0)),0);
      // Value received
      let valRecv=valIn.reduce((s,x)=>{
        const amt=Math.abs(parseFloat(x.tokenAmount||0));
        return s+(x.mint===SOL_MINT?amt*150:amt);
      },0);
      valRecv+=natIn.reduce((s,n)=>s+Math.abs(n.amount)/1e9*150,0);
      if(tokAmt>0){
        sellCount++;tokenSold+=tokAmt;totalValueOut+=valRecv;
        trades.push({type:"SELL",token:tokAmt,usd:valRecv,ts:tx.timestamp,sig:tx.signature});
      }
    }
  }

  // Calculate PnL
  // Realized PnL = value received from sells - proportional cost basis
  // Unrealized PnL = current holdings value - remaining cost basis
  const totalTrades=buyCount+sellCount;
  const realizedPnL=totalValueOut-(tokenSold>0&&tokenBought>0?(totalValueIn*(tokenSold/tokenBought)):0);
  const costBasis=totalValueIn;
  const avgBuyPrice=tokenBought>0?totalValueIn/tokenBought:null;
  
  // Win rate: trades where sell value > proportional buy cost
  const winRate=sellCount>0?(trades.filter(t=>t.type==="SELL"&&t.usd>0).length/sellCount)*100:
    buyCount>0?0:null;
  
  const avgHold=firstBuy&&lastTx?Math.abs(lastTx-firstBuy)/3600:null;

  return{
    realizedPnL: totalTrades>0?realizedPnL:null,
    totalValueIn, totalValueOut, tokenBought, tokenSold,
    buyCount, sellCount, winRate, avgHold, firstBuy, avgBuyPrice,
    trades, totalTrades, costBasis
  };
}

// Compute unrealized PnL given current token price
function computeFullPnL(pnlData, currentHolding, currentPriceUSD){
  if(!pnlData||!currentPriceUSD)return pnlData;
  const holdingValue=currentHolding*currentPriceUSD;
  const remainingCostBasis=pnlData.tokenBought>0?
    pnlData.costBasis*((pnlData.tokenBought-pnlData.tokenSold)/pnlData.tokenBought):0;
  const unrealizedPnL=holdingValue-Math.max(remainingCostBasis,0);
  const totalPnL=(pnlData.realizedPnL||0)+unrealizedPnL;
  return{...pnlData, holdingValue, unrealizedPnL, totalPnL, remainingCostBasis};
}

function classify(h, all){
  const p=h.pct;const fl=[];let lb="Holder",rs=0;
  if(p>10){lb="Whale";rs+=25;fl.push({s:"w",t:`Holds ${p.toFixed(2)}% — whale`})}
  else if(p>5){lb="Large Holder";rs+=15;fl.push({s:"w",t:`${p.toFixed(2)}% — large`})}
  else if(p>2){lb="Mid Holder";rs+=5}
  else if(p<0.01){lb="Dust";rs+=10;fl.push({s:"i",t:"Dust holding"})}

  const pnl=h.pnlData;
  if(pnl&&pnl.totalTrades>0){
    if(pnl.sellCount>pnl.buyCount*2&&pnl.sellCount>2){lb="Dumper";rs+=20;fl.push({s:"c",t:`${pnl.sellCount} sells vs ${pnl.buyCount} buys — dumping`})}
    else if(pnl.buyCount>0&&pnl.sellCount===0){fl.push({s:"g",t:"Diamond hands — only buys"})}
    if(pnl.avgHold!=null&&pnl.avgHold<0.5&&pnl.totalTrades>2){lb="Flipper";rs+=15;fl.push({s:"w",t:`Avg hold ${(pnl.avgHold*60).toFixed(0)}min`})}
    if(pnl.totalPnL!=null&&pnl.totalPnL>100){fl.push({s:"g",t:`Profitable: +$${pnl.totalPnL.toFixed(0)}`})}
    if(pnl.totalPnL!=null&&pnl.totalPnL<-50){rs+=10;fl.push({s:"w",t:`Losing: -$${Math.abs(pnl.totalPnL).toFixed(0)}`})}
  }

  if(h.txs?.length>2){
    const ts=h.txs.map(t=>t.timestamp).filter(Boolean).sort();
    if(ts.length>2){const gaps=[];for(let i=1;i<ts.length;i++)gaps.push(Math.abs(ts[i]-ts[i-1]));
      const avg=gaps.reduce((a,b)=>a+b,0)/gaps.length;
      if(avg<5){lb="Sniper Bot";rs+=35;fl.push({s:"c",t:"<5s TX gaps — bot"})}
      else if(avg<20){if(lb==="Holder")lb="Fast Trader";rs+=10;fl.push({s:"w",t:"Rapid TX pattern"})}
    }
    const sw=h.txs.filter(t=>t.type==="SWAP").length;
    if(sw>12){if(lb==="Holder")lb="Active Trader";fl.push({s:"i",t:`${sw} swaps`})}
  }

  if(h.owner?.startsWith("1111")){lb="Burn";rs=0;fl.length=0;fl.push({s:"g",t:"Burn address"})}
  if(!fl.length)fl.push({s:"g",t:"No anomalies"});
  return{lb,rs:Math.min(rs,100),fl};
}

function computeRugDNA(holders, sec){
  const t10=holders.slice(0,10).reduce((s,h)=>s+h.pct,0);
  const t5=holders.slice(0,5).reduce((s,h)=>s+h.pct,0);
  let sc=0;const f=[];
  if(t10>70){sc+=35;f.push({s:"c",t:`Top 10 control ${t10.toFixed(1)}%`})}
  else if(t10>50){sc+=20;f.push({s:"w",t:`Top 10 control ${t10.toFixed(1)}%`})}
  else f.push({s:"g",t:`Top 10 hold ${t10.toFixed(1)}%`});
  if(t5>50){sc+=15;f.push({s:"c",t:`Top 5 hold ${t5.toFixed(1)}%`})}
  const wh=holders.filter(h=>h.pct>5).length;
  if(wh>3){sc+=15;f.push({s:"w",t:`${wh} wallets >5%`})}
  const dumpers=holders.filter(h=>h.lb==="Dumper").length;
  if(dumpers>1){sc+=15;f.push({s:"c",t:`${dumpers} dumpers detected`})}
  const bots=holders.filter(h=>h.lb==="Sniper Bot").length;
  if(bots>1){sc+=10;f.push({s:"w",t:`${bots} sniper bots`})}
  const prof=holders.filter(h=>h.pnlData?.totalPnL>0).length;
  const losing=holders.filter(h=>h.pnlData?.totalPnL!=null&&h.pnlData.totalPnL<0).length;
  if(prof+losing>0)f.push({s:"i",t:`${prof} profitable, ${losing} losing`});
  if(sec){
    if(sec.isMintable){sc+=25;f.push({s:"c",t:"MINTABLE"})}
    if(sec.isFreezable){sc+=20;f.push({s:"c",t:"FREEZABLE"})}
    if(!sec.isMintable&&!sec.isFreezable)f.push({s:"g",t:"Not mintable/freezable"});
  }
  if(sc<=10)f.unshift({s:"g",t:"No major red flags"});
  sc=Math.min(sc,100);
  return{sc,lv:sc>60?"HIGH RISK":sc>30?"MEDIUM":"LOW RISK",f,
    st:{t10,t5,wh,bots,dumpers,prof,losing,n:holders.length,mint:sec?.isMintable||false,freeze:sec?.isFreezable||false}};
}

// ─── UTILS ──────────────────────────────────────────────
const tr=(a,n=4)=>a?`${a.slice(0,n)}...${a.slice(-n)}`:"—";
const ago=ts=>{if(!ts)return"—";const s=Math.floor(Date.now()/1000-ts);if(s<0)return"now";if(s<60)return s+"s";if(s<3600)return Math.floor(s/60)+"m";if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d"};
const $u=n=>{if(n==null)return"—";const a=Math.abs(n);const sign=n>=0?"+":"-";if(a>=1e6)return`${sign}$${(a/1e6).toFixed(2)}M`;if(a>=1e3)return`${sign}$${(a/1e3).toFixed(1)}K`;if(a>=1)return`${sign}$${a.toFixed(2)}`;return`${sign}$${a.toFixed(4)}`};
const $v=n=>{if(n==null||isNaN(n))return"—";if(Math.abs(n)>=1e9)return`$${(n/1e9).toFixed(2)}B`;if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(1)}K`;return`$${parseFloat(n).toFixed(2)}`};
const pf=n=>n!=null?`${n>=0?"+":""}${parseFloat(n).toFixed(2)}%`:"—";
const fp=n=>{if(!n)return"—";if(n<1e-5)return`$${parseFloat(n).toExponential(2)}`;if(n<0.01)return`$${parseFloat(n).toFixed(6)}`;if(n<1)return`$${parseFloat(n).toFixed(4)}`;return`$${parseFloat(n).toFixed(2)}`};

// ─── UI ATOMS ───────────────────────────────────────────
const B=({text,color=C.g})=><span style={{display:"inline-block",padding:"2px 6px",fontSize:8.5,fontWeight:700,color,background:`${color}15`,border:`1px solid ${color}30`,borderRadius:3,letterSpacing:1,textTransform:"uppercase",fontFamily:"inherit",whiteSpace:"nowrap"}}>{text}</span>;
const Dot=({color=C.g,label="LIVE"})=><span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color,letterSpacing:1.5}}><span style={{width:6,height:6,borderRadius:"50%",background:color,boxShadow:`0 0 8px ${color}`,animation:"pulse 2s ease-in-out infinite"}}/>{label}</span>;
const RBar=({score})=>{const co=score>60?C.r:score>30?C.y:C.g;return<div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:90,height:5,background:`${C.tM}33`,borderRadius:3,overflow:"hidden"}}><div style={{width:`${Math.min(score,100)}%`,height:"100%",borderRadius:3,background:`linear-gradient(90deg,${C.g},${score>30?C.y:C.g},${score>60?C.r:C.y})`,transition:"width 0.6s"}}/></div><span style={{fontSize:12,fontWeight:700,color:co}}>{score}/100</span></div>};
const St=({l,v,color=C.t,sm})=><div style={{textAlign:"center"}}><div style={{fontSize:sm?13:17,fontWeight:700,color}}>{v}</div><div style={{fontSize:8,color:C.tM,letterSpacing:1.5,marginTop:2}}>{l}</div></div>;
const KV=({k,v,color=C.t})=><div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:11}}><span style={{color:C.tS}}>{k}</span><span style={{color}}>{v}</span></div>;
const Ld=({text})=><div style={{textAlign:"center",padding:50}}><div style={{display:"inline-flex",gap:3,marginBottom:14}}>{[0,1,2,3,4,5,6].map(i=><div key={i} style={{width:3,height:20,background:C.g,borderRadius:1,animation:`pulse 0.8s ease ${i*0.1}s infinite`,boxShadow:`0 0 6px ${C.gG}`}}/>)}</div><div style={{fontSize:11,color:C.g,letterSpacing:3}}>{text}</div></div>;
const fc=s=>s==="c"?C.r:s==="w"?C.y:s==="g"?C.g:C.c;
const fi=s=>s==="c"?"✖":s==="w"?"⚠":"✓";
const Spin=()=><span style={{display:"inline-block",width:8,height:8,border:`2px solid ${C.tM}`,borderTopColor:C.g,borderRadius:"50%",animation:"spin 0.6s linear infinite"}}/>;

// ─── WALLET ROW ─────────────────────────────────────────
function WRow({h,exp,onTog,onW,sym,tokenPrice}){
  const rc=h.rs>60?C.r:h.rs>30?C.y:C.g;
  const lc=h.lb==="Sniper Bot"||h.lb==="Dumper"?C.r:h.lb==="Whale"?C.o:h.lb==="Flipper"?C.p:h.lb.includes("Trader")?C.y:h.lb==="Burn"?C.tM:C.c;
  const pnl=h.pnlData;
  const loading=h.enriching;
  const holdVal=h.amt&&tokenPrice?h.amt*tokenPrice:null;
  const totalPnL=pnl?.totalPnL;
  const wr=pnl?.winRate;
  const ah=pnl?.avgHold;

  return<div style={{background:exp?C.bgH:C.bgC,border:`1px solid ${exp?C.bdH:C.bd}`,borderRadius:5,marginBottom:3,cursor:"pointer"}}>
    <div onClick={onTog} style={{display:"grid",gridTemplateColumns:"28px 1.4fr 0.5fr 0.4fr 0.7fr 0.4fr 0.45fr 0.5fr 38px",alignItems:"center",padding:"7px 8px",gap:3}}>
      <span style={{fontSize:10,color:C.tM}}>#{h.rank}</span>
      <div style={{display:"flex",alignItems:"center",gap:4,overflow:"hidden"}}><span style={{fontSize:11,color:C.t}}>{tr(h.owner,5)}</span><B text={h.lb} color={lc}/></div>
      <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{h.pct.toFixed(2)}%</span>
      <span style={{fontSize:11,color:rc,textAlign:"right"}}>{h.rs}</span>
      <div style={{textAlign:"right"}}>
        {loading?<Spin/>:totalPnL!=null?<div>
          <div style={{fontSize:11,fontWeight:600,color:totalPnL>=0?C.g:C.r}}>{$u(totalPnL)}</div>
        </div>:<span style={{fontSize:11,color:C.tM}}>—</span>}
      </div>
      <span style={{fontSize:11,textAlign:"right",color:wr!=null?(wr>=50?C.g:C.r):C.tM}}>{loading?<Spin/>:wr!=null?`${wr.toFixed(0)}%`:"—"}</span>
      <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{loading?<Spin/>:ah!=null?ah<1?`${(ah*60).toFixed(0)}m`:`${ah.toFixed(1)}h`:"—"}</span>
      <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{holdVal!=null?$v(holdVal):"—"}</span>
      <button onClick={e=>{e.stopPropagation();onW(h)}} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.tS,cursor:"pointer",padding:"2px 4px",fontSize:8,fontFamily:"inherit"}}
        onMouseEnter={e=>{e.target.style.borderColor=C.g;e.target.style.color=C.g}} onMouseLeave={e=>{e.target.style.borderColor=C.bd;e.target.style.color=C.tS}}>+W</button>
    </div>
    {exp&&<div style={{padding:"0 8px 12px",borderTop:`1px solid ${C.bd}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,animation:"fadeIn 0.2s"}}>
      <div style={{paddingTop:10}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:6}}>WALLET</div>
        <KV k="Address" v={tr(h.owner,10)}/><KV k="SOL" v={h.sol!=null?`${h.sol.toFixed(3)} SOL`:"..."} color={h.sol!=null?C.t:C.tM}/>
        <KV k="Holding" v={`${h.amt?.toLocaleString(undefined,{maximumFractionDigits:0})} ${sym}`}/>
        <KV k="Bag Value" v={holdVal!=null?$v(holdVal):"—"} color={C.g}/>
        <KV k="% Supply" v={`${h.pct.toFixed(4)}%`}/>
        {pnl&&pnl.totalTrades>0&&<>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>P&L BREAKDOWN</div>
          <KV k="Total PnL" v={totalPnL!=null?$u(totalPnL):"—"} color={totalPnL!=null?(totalPnL>=0?C.g:C.r):C.tM}/>
          <KV k="Realized PnL" v={pnl.realizedPnL!=null?$u(pnl.realizedPnL):"—"} color={pnl.realizedPnL>=0?C.g:C.r}/>
          <KV k="Unrealized PnL" v={pnl.unrealizedPnL!=null?$u(pnl.unrealizedPnL):"—"} color={(pnl.unrealizedPnL||0)>=0?C.g:C.r}/>
          <KV k="Cost Basis" v={pnl.costBasis>0?$v(pnl.costBasis):"—"}/>
          <KV k="Avg Buy Price" v={pnl.avgBuyPrice?fp(pnl.avgBuyPrice):"—"}/>
          <KV k="Win Rate" v={wr!=null?`${wr.toFixed(1)}%`:"—"} color={wr!=null?(wr>=50?C.g:C.r):C.tM}/>
          <KV k="Buys / Sells" v={`${pnl.buyCount} / ${pnl.sellCount}`}/>
          <KV k="Tokens Bought" v={pnl.tokenBought>0?pnl.tokenBought.toLocaleString(undefined,{maximumFractionDigits:0}):"—"}/>
          <KV k="Tokens Sold" v={pnl.tokenSold>0?pnl.tokenSold.toLocaleString(undefined,{maximumFractionDigits:0}):"—"}/>
          <KV k="Value Spent" v={pnl.totalValueIn>0?$v(pnl.totalValueIn):"—"}/>
          <KV k="Value Received" v={pnl.totalValueOut>0?$v(pnl.totalValueOut):"—"}/>
          <KV k="Avg Hold" v={ah!=null?ah<1?`${(ah*60).toFixed(0)} min`:`${ah.toFixed(1)}h`:"—"}/>
          <KV k="First Buy" v={pnl.firstBuy?`${ago(pnl.firstBuy)} ago`:"—"}/>
        </>}
        {pnl?.trades?.length>0&&<>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>TRADE LOG</div>
          {pnl.trades.slice(0,8).map((t,i)=><div key={i} style={{display:"flex",gap:5,fontSize:10,marginBottom:2,alignItems:"center"}}>
            <B text={t.type} color={t.type==="BUY"?C.g:C.r}/>
            <span style={{color:C.tS}}>{t.token?.toLocaleString(undefined,{maximumFractionDigits:0})} {sym}</span>
            <span style={{color:C.t,fontWeight:600}}>{$v(t.usd)}</span>
            <span style={{color:C.tM}}>{ago(t.ts)}</span>
          </div>)}
        </>}
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>FLAGS</div>
        {h.fl.map((f,i)=><div key={i} style={{display:"flex",gap:4,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
      </div>
      <div style={{paddingTop:10}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:6}}>RECENT TXS ({(h.txs||[]).length})</div>
        {(!h.txs||!h.txs.length)&&<div style={{fontSize:10,color:C.tM}}>Loading...</div>}
        {(h.txs||[]).slice(0,12).map((tx,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"3px 4px",marginBottom:2,borderRadius:3,background:`${C.bg}88`,fontSize:9.5,gap:3}}>
          <B text={tx.type||"TX"} color={tx.type==="SWAP"?C.c:tx.type==="TRANSFER"?C.y:tx.type?.includes("NFT")?C.p:C.tS}/>
          <span style={{color:C.tS,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginLeft:2}}>{tx.description?.slice(0,40)||tr(tx.signature,6)}</span>
          <span style={{color:C.tM,flexShrink:0}}>{ago(tx.timestamp)}</span>
        </div>)}
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:4}}>LINKS</div>
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
      <St l="PROFIT" v={rd.st.prof} color={C.g} sm/>
      <St l="LOSING" v={rd.st.losing} color={rd.st.losing>3?C.r:C.t} sm/>
      <St l="MINTABLE" v={rd.st.mint?"YES":"NO"} color={rd.st.mint?C.r:C.g} sm/>
      <St l="FREEZABLE" v={rd.st.freeze?"YES":"NO"} color={rd.st.freeze?C.r:C.g} sm/>
    </div>
    {rd.f.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
  </div>;
}

function TH({m}){if(!m)return null;const ch=m.priceChange24hPercent||0;
  return<div style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",gap:8,marginBottom:10,padding:12,background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,alignItems:"center"}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>{m.logoURI&&<img src={m.logoURI} alt="" style={{width:26,height:26,borderRadius:"50%",border:`1px solid ${C.bd}`}}/>}<div><div style={{fontSize:13,fontWeight:700}}>{m.symbol||"—"}</div><div style={{fontSize:9,color:C.tM}}>{m.name}</div></div></div>
    <St l="PRICE" v={fp(m.price)}/><St l="MCAP" v={$v(m.mc||m.marketCap)}/><St l="24H VOL" v={$v(m.v24hUSD)}/><St l="LIQUIDITY" v={$v(m.liquidity)}/><St l="24H" v={pf(ch)} color={ch>=0?C.g:C.r}/>
  </div>;
}

function VTab(){const[addr,sA]=useState("");const[ld,sL]=useState(false);const[d,sD]=useState(null);const[err,sE]=useState("");
  const scan=async()=>{if(!addr.trim())return;sL(true);sE("");sD(null);
    try{const[bal,txs,port]=await Promise.all([getSolBal(addr),getTxs(addr),getPortfolio(addr)]);
      const tok=(port||[]).filter(t=>t.valueUsd>0.01).sort((a,b)=>(b.valueUsd||0)-(a.valueUsd||0));
      const tv=tok.reduce((s,t)=>s+(t.valueUsd||0),0);
      const types={};(txs||[]).forEach(tx=>{const t=tx.type||"UNKNOWN";types[t]=(types[t]||0)+1});
      let rs=0;const fl=[];
      if(bal<0.01){rs+=15;fl.push({s:"w",t:"Low SOL"})}
      if(!fl.length)fl.push({s:"g",t:"No anomalies"});
      sD({addr,bal,txs:txs||[],tok,tv,rs:Math.min(rs,100),fl,types});
    }catch(e){sE(e.message)}sL(false)};
  return<div>
    <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:3}}>VALIDATE WALLET</div>
    <div style={{display:"flex",gap:8,marginBottom:20}}>
      <input value={addr} onChange={e=>sA(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="Paste wallet..."
        style={{flex:1,padding:"11px 14px",background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,color:C.t,fontFamily:"inherit",fontSize:12,outline:"none"}}
        onFocus={e=>e.target.style.borderColor=C.g} onBlur={e=>e.target.style.borderColor=C.bd}/>
      <button onClick={scan} disabled={ld} style={{padding:"11px 24px",background:"transparent",border:`1px solid ${C.g}`,borderRadius:5,color:C.g,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:ld?"wait":"pointer",letterSpacing:2}}>{ld?"...":"DEEP SCAN"}</button>
    </div>
    {ld&&<Ld text="SCANNING..."/>}
    {d&&!ld&&<div style={{animation:"fadeIn 0.3s"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
        {[["SOL",d.bal.toFixed(3),C.t],["PORTFOLIO",$v(d.tv),C.t],["TOKENS",d.tok.length,C.t],["TXS",d.txs.length,C.c]].map(([l,v,c])=>
          <div key={l} style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:11,textAlign:"center"}}><div style={{fontSize:17,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:8,color:C.tM,marginTop:3}}>{l}</div></div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>FLAGS</div>
          {d.fl.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
        </div>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
          <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>TX TYPES</div>
          {Object.entries(d.types).sort((a,b)=>b[1]-a[1]).map(([t,c])=><KV key={t} k={t} v={c}/>)}
        </div>
      </div>
      <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>HOLDINGS</div>
        {d.tok.slice(0,20).map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 6px",borderRadius:3,background:i%2?`${C.bg}55`:"transparent",fontSize:10.5}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>{t.logoURI&&<img src={t.logoURI} alt="" style={{width:15,height:15,borderRadius:"50%"}}/>}<span style={{color:C.t,fontWeight:600}}>{t.symbol||"?"}</span></div>
          <span style={{color:C.tS}}>{parseFloat(t.uiAmount||0).toLocaleString(undefined,{maximumFractionDigits:1})}</span>
          <span style={{color:C.t}}>{$v(t.valueUsd)}</span>
        </div>)}
      </div>
    </div>}
  </div>;
}

function WL({wl,onRm,tokenPrice,sym}){
  const[wExp,setWExp]=useState(null);
  if(!wl.length)return<div style={{textAlign:"center",padding:60}}><div style={{fontSize:28,opacity:.2,marginBottom:8}}>👁</div><div style={{fontSize:11,color:C.tS}}>No wallets watched</div><div style={{fontSize:10,color:C.tM,marginTop:4}}>+W holders in Discover to track</div></div>;
  return<div>
    <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>WATCHED — {wl.length} wallets</div>
    <div style={{display:"grid",gridTemplateColumns:"28px 1.4fr 0.5fr 0.4fr 0.7fr 0.4fr 0.45fr 0.5fr 38px",padding:"4px 8px",gap:3,fontSize:8,color:C.tM,letterSpacing:1.2,borderBottom:`1px solid ${C.bd}`,marginBottom:3}}>
      <span>#</span><span>WALLET</span><span style={{textAlign:"right"}}>HOLD%</span><span style={{textAlign:"right"}}>RISK</span><span style={{textAlign:"right"}}>TOTAL PnL</span><span style={{textAlign:"right"}}>WIN%</span><span style={{textAlign:"right"}}>AVG HOLD</span><span style={{textAlign:"right"}}>BAG $</span><span></span>
    </div>
    {wl.map((w,i)=>{
      const pnl=w.pnlData;const tp=pnl?.totalPnL;const wr=pnl?.winRate;const ah=pnl?.avgHold;
      const rc=w.rs>60?C.r:w.rs>30?C.y:C.g;
      const lc=w.lb==="Sniper Bot"||w.lb==="Dumper"?C.r:w.lb==="Whale"?C.o:w.lb==="Flipper"?C.p:w.lb.includes("Trader")?C.y:C.c;
      const holdVal=w.amt&&tokenPrice?w.amt*tokenPrice:null;
      const isExp=wExp===w.owner;
      return<div key={i} style={{background:isExp?C.bgH:C.bgC,border:`1px solid ${isExp?C.bdH:C.bd}`,borderRadius:5,marginBottom:3,cursor:"pointer"}}>
        <div onClick={()=>setWExp(isExp?null:w.owner)} style={{display:"grid",gridTemplateColumns:"28px 1.4fr 0.5fr 0.4fr 0.7fr 0.4fr 0.45fr 0.5fr 38px",alignItems:"center",padding:"7px 8px",gap:3}}>
          <span style={{fontSize:10,color:C.tM}}>#{i+1}</span>
          <div style={{display:"flex",alignItems:"center",gap:4,overflow:"hidden"}}><span style={{fontSize:11,color:C.t}}>{tr(w.owner,5)}</span><B text={w.lb} color={lc}/></div>
          <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{w.pct.toFixed(2)}%</span>
          <span style={{fontSize:11,color:rc,textAlign:"right"}}>{w.rs}</span>
          <span style={{fontSize:11,textAlign:"right",color:tp!=null?(tp>=0?C.g:C.r):C.tM,fontWeight:600}}>{tp!=null?$u(tp):"—"}</span>
          <span style={{fontSize:11,textAlign:"right",color:wr!=null?(wr>=50?C.g:C.r):C.tM}}>{wr!=null?`${wr.toFixed(0)}%`:"—"}</span>
          <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{ah!=null?ah<1?`${(ah*60).toFixed(0)}m`:`${ah.toFixed(1)}h`:"—"}</span>
          <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{holdVal!=null?$v(holdVal):"—"}</span>
          <button onClick={e=>{e.stopPropagation();onRm(i)}} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.r,cursor:"pointer",padding:"2px 4px",fontSize:8,fontFamily:"inherit"}}>X</button>
        </div>
        {isExp&&<div style={{padding:"0 8px 12px",borderTop:`1px solid ${C.bd}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,animation:"fadeIn 0.2s"}}>
          <div style={{paddingTop:10}}>
            <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:6}}>WALLET</div>
            <KV k="Address" v={tr(w.owner,10)}/><KV k="SOL" v={w.sol!=null?`${w.sol.toFixed(3)} SOL`:"—"}/>
            <KV k="Holding" v={`${w.amt?.toLocaleString(undefined,{maximumFractionDigits:0})} ${sym||""}`}/>
            <KV k="Bag Value" v={holdVal!=null?$v(holdVal):"—"} color={C.g}/>
            <KV k="% Supply" v={`${w.pct.toFixed(4)}%`}/>
            {pnl&&pnl.totalTrades>0&&<>
              <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>P&L BREAKDOWN</div>
              <KV k="Total PnL" v={tp!=null?$u(tp):"—"} color={tp!=null?(tp>=0?C.g:C.r):C.tM}/>
              <KV k="Realized" v={pnl.realizedPnL!=null?$u(pnl.realizedPnL):"—"} color={(pnl.realizedPnL||0)>=0?C.g:C.r}/>
              <KV k="Unrealized" v={pnl.unrealizedPnL!=null?$u(pnl.unrealizedPnL):"—"} color={(pnl.unrealizedPnL||0)>=0?C.g:C.r}/>
              <KV k="Cost Basis" v={pnl.costBasis>0?$v(pnl.costBasis):"—"}/>
              <KV k="Avg Buy" v={pnl.avgBuyPrice?fp(pnl.avgBuyPrice):"—"}/>
              <KV k="Win Rate" v={wr!=null?`${wr.toFixed(1)}%`:"—"} color={wr!=null?(wr>=50?C.g:C.r):C.tM}/>
              <KV k="Buys / Sells" v={`${pnl.buyCount} / ${pnl.sellCount}`}/>
              <KV k="Avg Hold" v={ah!=null?ah<1?`${(ah*60).toFixed(0)} min`:`${ah.toFixed(1)}h`:"—"}/>
            </>}
            {pnl?.trades?.length>0&&<>
              <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>TRADE LOG</div>
              {pnl.trades.slice(0,8).map((t,j)=><div key={j} style={{display:"flex",gap:5,fontSize:10,marginBottom:2,alignItems:"center"}}>
                <B text={t.type} color={t.type==="BUY"?C.g:C.r}/>
                <span style={{color:C.tS}}>{t.token?.toLocaleString(undefined,{maximumFractionDigits:0})} {sym||""}</span>
                <span style={{color:C.t,fontWeight:600}}>{$v(t.usd)}</span>
                <span style={{color:C.tM}}>{ago(t.ts)}</span>
              </div>)}
            </>}
            <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>FLAGS</div>
            {w.fl.map((f,j)=><div key={j} style={{display:"flex",gap:4,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
          </div>
          <div style={{paddingTop:10}}>
            <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:6}}>RECENT TXS ({(w.txs||[]).length})</div>
            {(w.txs||[]).slice(0,12).map((tx,j)=><div key={j} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"3px 4px",marginBottom:2,borderRadius:3,background:`${C.bg}88`,fontSize:9.5,gap:3}}>
              <B text={tx.type||"TX"} color={tx.type==="SWAP"?C.c:tx.type==="TRANSFER"?C.y:C.tS}/>
              <span style={{color:C.tS,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginLeft:2}}>{tx.description?.slice(0,40)||tr(tx.signature,6)}</span>
              <span style={{color:C.tM,flexShrink:0}}>{ago(tx.timestamp)}</span>
            </div>)}
            {(!w.txs||!w.txs.length)&&<div style={{fontSize:10,color:C.tM}}>No TX data — expand in Discover first</div>}
            <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:4}}>LINKS</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {[["Solscan",`https://solscan.io/account/${w.owner}`],["Birdeye",`https://birdeye.so/profile/${w.owner}?chain=solana`],["SolanaFM",`https://solana.fm/address/${w.owner}`]].map(([n,u])=>
                <a key={n} href={u} target="_blank" rel="noopener noreferrer" style={{padding:"2px 7px",borderRadius:3,fontSize:9,color:C.g,background:C.gD,border:`1px solid ${C.g}30`,fontFamily:"inherit"}}>{n}↗</a>)}
            </div>
          </div>
        </div>}
      </div>;
    })}
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

  const enrichWallet=async(holders,idx,mint,tokenPrice)=>{
    const h=holders[idx];if(!h)return;
    try{
      const[bal,txs]=await Promise.all([getSolBal(h.owner),getTxs(h.owner)]);
      holders[idx].sol=bal;holders[idx].txs=txs||[];holders[idx].enriching=false;
      let pnlData=parseTxPnL(txs||[],mint,h.owner);
      pnlData=computeFullPnL(pnlData,h.amt,tokenPrice);
      holders[idx].pnlData=pnlData;
      const rc=classify(holders[idx],holders);
      holders[idx].lb=rc.lb;holders[idx].rs=rc.rs;holders[idx].fl=rc.fl;
    }catch{holders[idx].enriching=false}
  };

  const discover=async()=>{
    if(!ca.trim())return;setLd(true);setErr("");setHl([]);setRd(null);setTm(null);setExp(null);setEnriched(0);
    try{
      setMsg("Token data...");
      const[ov,sec]=await Promise.all([getOverview(ca),getSecurity(ca)]);
      if(ov)setTm(ov);
      const tokenPrice=ov?.price||0;
      setMsg("Holders...");
      const raw=await getHolders(ca);
      if(!raw?.length){setErr("No holders — check mint");setLd(false);return}
      const tot=raw.reduce((s,h)=>s+h.amt,0);
      const holders=raw.map((h,i)=>({...h,rank:i+1,pct:tot>0?(h.amt/tot)*100:0,txs:[],sol:null,pnlData:null,enriching:true,fl:[],lb:"Holder",rs:0}));
      for(const h of holders){const c=classify(h,holders);h.lb=c.lb;h.rs=c.rs;h.fl=c.fl}
      setHl([...holders]);
      setRd(computeRugDNA(holders,sec));
      setLd(false);
      // Enrich in parallel batches
      const total=holders.length;setEnrichTotal(total);
      for(let b=0;b<total;b+=5){
        await Promise.all(Array.from({length:Math.min(5,total-b)},(_,i)=>enrichWallet(holders,b+i,ca,tokenPrice)));
        setEnriched(Math.min(b+5,total));
        setHl([...holders]);
        setRd(computeRugDNA(holders,sec));
      }
      for(const h of holders)h.enriching=false;
      setHl([...holders]);setEnrichTotal(0);
    }catch(e){setErr(e.message);setLd(false)}
  };

  const sorted=[...hl].sort((a,b)=>{
    if(sort==="rank")return a.rank-b.rank;
    if(sort==="risk")return b.rs-a.rs;
    if(sort==="pnl")return(b.pnlData?.totalPnL||0)-(a.pnlData?.totalPnL||0);
    return b.pct-a.pct;
  }).filter(h=>filt==="ALL"||h.lb===filt);
  const labels=["ALL",...new Set(hl.map(h=>h.lb))];
  const tokenPrice=tm?.price||0;

  return<div style={{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"'JetBrains Mono','Fira Code',monospace"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes glow{0%,100%{box-shadow:0 0 8px ${C.gG}}50%{box-shadow:0 0 20px ${C.gG}}}@keyframes spin{to{transform:rotate(360deg)}}
      ::selection{background:${C.g}25;color:${C.g}}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.bd};border-radius:3px}input::placeholder{color:${C.tM}}a{text-decoration:none}`}</style>
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:90,background:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,255,136,0.004) 3px,rgba(0,255,136,0.004) 4px)"}}/>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",borderBottom:`1px solid ${C.bd}`,background:`${C.bgS}dd`,backdropFilter:"blur(10px)",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:3,height:24,background:C.g,borderRadius:1,boxShadow:`0 0 10px ${C.gG}`,animation:"glow 3s ease infinite"}}/>
        <div><div style={{fontSize:16,fontWeight:800,letterSpacing:7}}>SIGNAL</div><div style={{fontSize:8,letterSpacing:3,color:C.g,marginTop:-2}}>WALLET DISCOVERY ENGINE</div></div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:C.tS,letterSpacing:2}}>HELIUS</a>
        <a href="https://birdeye.so" target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:C.tS,letterSpacing:2}}>BIRDEYE</a>
        <Dot/>{enrichTotal>0&&<Dot color={C.y} label={`${enriched}/${enrichTotal}`}/>}
      </div>
    </header>
    <main style={{maxWidth:1500,margin:"0 auto",padding:"16px 20px"}}>
      <div style={{display:"flex",gap:3,marginBottom:18}}>
        {[{id:"discover",l:"DISCOVER",s:"Token → Wallets + PnL"},{id:"validate",l:"VALIDATE",s:"Wallet → Deep State"},{id:"watchlist",l:"WATCHLIST",s:`${wl.length} saved`}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"9px 22px",background:tab===t.id?C.bgH:"transparent",border:`1px solid ${tab===t.id?C.g:C.bd}`,borderRadius:5,cursor:"pointer",textAlign:"center",fontFamily:"inherit"}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:tab===t.id?C.g:C.tS}}>{t.l}</div>
            <div style={{fontSize:8,color:tab===t.id?C.gM:C.tM,marginTop:1}}>{t.s}</div>
          </button>)}
      </div>
      {tab==="discover"&&<div style={{animation:"fadeIn 0.2s"}}>
        <div style={{fontSize:10.5,color:C.tS,marginBottom:12}}>Token CA → holders → PnL → win rate → avg hold → risk → rug DNA</div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={ca} onChange={e=>setCa(e.target.value)} onKeyDown={e=>e.key==="Enter"&&discover()} placeholder="Paste Solana token mint address..."
            style={{flex:1,padding:"11px 14px",background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,color:C.t,fontFamily:"inherit",fontSize:12,outline:"none"}}
            onFocus={e=>e.target.style.borderColor=C.g} onBlur={e=>e.target.style.borderColor=C.bd}/>
          <button onClick={discover} disabled={ld} style={{padding:"11px 24px",background:"transparent",border:`1px solid ${C.g}`,borderRadius:5,color:C.g,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:ld?"wait":"pointer",letterSpacing:2,minWidth:150}}>{ld?"SCANNING...":"FIND WALLETS"}</button>
        </div>
        {err&&<div style={{color:C.r,fontSize:11,marginBottom:10,padding:"8px 12px",background:C.rD,borderRadius:4}}>{err}</div>}
        {ld&&<Ld text={msg}/>}
        {!ld&&hl.length>0&&<div style={{animation:"fadeIn 0.3s"}}>
          <TH m={tm}/>
          <RDP rd={rd}/>
          {enrichTotal>0&&<div style={{fontSize:10,color:C.y,marginBottom:6}}>⟳ Enriching {enriched}/{enrichTotal} — PnL populating live...</div>}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,flexWrap:"wrap",gap:6}}>
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
          <div style={{display:"grid",gridTemplateColumns:"28px 1.4fr 0.5fr 0.4fr 0.7fr 0.4fr 0.45fr 0.5fr 38px",padding:"4px 8px",gap:3,fontSize:8,color:C.tM,letterSpacing:1.2,borderBottom:`1px solid ${C.bd}`,marginBottom:3}}>
            <span>#</span><span>WALLET</span><span style={{textAlign:"right"}}>HOLD%</span><span style={{textAlign:"right"}}>RISK</span><span style={{textAlign:"right"}}>TOTAL PnL</span><span style={{textAlign:"right"}}>WIN%</span><span style={{textAlign:"right"}}>AVG HOLD</span><span style={{textAlign:"right"}}>BAG $</span><span></span>
          </div>
          {sorted.map(h=><WRow key={h.tAcc} h={h} sym={tm?.symbol||""} tokenPrice={tokenPrice} exp={exp===h.owner} onTog={()=>setExp(exp===h.owner?null:h.owner)} onW={w=>{if(!wl.find(x=>x.owner===w.owner))setWl([...wl,w])}}/>)}
          <div style={{textAlign:"center",padding:10,fontSize:9,color:C.tM,letterSpacing:2}}>
            {sorted.length} WALLETS • {hl.filter(h=>h.pnlData?.totalPnL!=null).length} ANALYZED • {hl.filter(h=>h.pnlData?.totalPnL>0).length} PROFITABLE • {hl.filter(h=>h.rs>50).length} FLAGGED
          </div>
        </div>}
        {!ld&&!hl.length&&!err&&<div style={{textAlign:"center",padding:60}}><div style={{fontSize:36,opacity:.2,marginBottom:12}}>⚡</div><div style={{fontSize:11,color:C.tS,letterSpacing:2}}>PASTE A TOKEN MINT</div></div>}
      </div>}
      {tab==="validate"&&<div style={{animation:"fadeIn 0.2s"}}><VTab/></div>}
      {tab==="watchlist"&&<div style={{animation:"fadeIn 0.2s"}}><WL wl={wl} onRm={i=>setWl(wl.filter((_,x)=>x!==i))} tokenPrice={tokenPrice} sym={tm?.symbol||""}/></div>}
    </main>
    <footer style={{padding:"12px 20px",borderTop:`1px solid ${C.bd}`,display:"flex",justifyContent:"space-between",marginTop:20}}>
      <span style={{fontSize:9,color:C.tM,letterSpacing:2}}>SIGNAL v3.3</span>
      <span style={{fontSize:9,color:C.tM}}>PnL = realized + unrealized (token transfers × price)</span>
    </footer>
  </div>;
}
