import { useState, useCallback } from "react";
const HK="efb053d6-f7c7-4c90-9bc5-0ce3af9c59df",BK="94ba9de0953642878038f5a7eccc1114";
const RPC=`https://mainnet.helius-rpc.com/?api-key=${HK}`,HAPI=`https://api.helius.xyz/v0`,BAPI=`https://public-api.birdeye.so`;
const C={bg:"#05070b",bgS:"#0a0e17",bgC:"#0d1219",bgH:"#121a27",bd:"#161f30",bdH:"#1e3a2a",g:"#00ff88",gD:"#00ff8820",gM:"#00cc6a",gG:"#00ff8840",r:"#ff2e4c",rD:"#ff2e4c18",y:"#ffc800",c:"#00cfff",cD:"#00cfff18",p:"#b44dff",o:"#ff8c00",t:"#dfe6f0",tS:"#5a6e8a",tM:"#2d3d56"};
const SOL_MINT="So11111111111111111111111111111111111111112";
const STABLES=new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);

async function rpc(m,p){try{const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})});return(await r.json()).result||null}catch{return null}}
async function bGet(ep,ps={}){try{const u=new URL(`${BAPI}${ep}`);Object.entries(ps).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{headers:{"X-API-KEY":BK,"x-chain":"solana"}});return r.ok?await r.json():null}catch{return null}}
async function getOverview(a){return(await bGet("/defi/token_overview",{address:a}))?.data||null}
async function getSecurity(a){return(await bGet("/defi/token_security",{address:a}))?.data||null}
async function getHolders(mint){const lg=await rpc("getTokenLargestAccounts",[mint]);if(!lg?.value)return[];return Promise.all(lg.value.slice(0,20).map(ac=>rpc("getAccountInfo",[ac.address,{encoding:"jsonParsed"}]).then(i=>{const p=i?.value?.data?.parsed?.info;return p?{tAcc:ac.address,owner:p.owner,amt:parseFloat(p.tokenAmount?.uiAmountString||"0")}:{tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0")}}).catch(()=>({tAcc:ac.address,owner:ac.address,amt:parseFloat(ac.uiAmountString||"0")}))))}
async function getSolBal(a){const r=await rpc("getBalance",[a]);return r?r/1e9:0}
async function getTxs(a){try{return await(await fetch(`${HAPI}/addresses/${a}/transactions?api-key=${HK}&limit=30`)).json()}catch{return[]}}
async function getPortfolio(a){return(await bGet("/v1/wallet/token_list",{wallet:a}))?.data?.items||[]}

function parseTxPnL(txs,tokenMint,wallet){
  let valIn=0,valOut=0,tokBuy=0,tokSell=0,buys=0,sells=0,first=null,last=null;const trades=[];
  for(const tx of(txs||[])){const xf=tx.tokenTransfers||[],nat=tx.nativeTransfers||[];last=tx.timestamp;
    const tIn=xf.filter(x=>x.mint===tokenMint&&x.toUserAccount===wallet);
    const tOut=xf.filter(x=>x.mint===tokenMint&&x.fromUserAccount===wallet);
    const vOut=xf.filter(x=>(x.mint===SOL_MINT||STABLES.has(x.mint))&&x.fromUserAccount===wallet);
    const vIn=xf.filter(x=>(x.mint===SOL_MINT||STABLES.has(x.mint))&&x.toUserAccount===wallet);
    const nOut=nat.filter(n=>n.fromUserAccount===wallet&&Math.abs(n.amount)>10000);
    const nIn=nat.filter(n=>n.toUserAccount===wallet&&Math.abs(n.amount)>10000);
    if(tIn.length>0){const a=tIn.reduce((s,x)=>s+Math.abs(parseFloat(x.tokenAmount||0)),0);let c=vOut.reduce((s,x)=>s+Math.abs(parseFloat(x.tokenAmount||0))*(x.mint===SOL_MINT?150:1),0)+nOut.reduce((s,n)=>s+Math.abs(n.amount)/1e9*150,0);if(a>0){buys++;tokBuy+=a;valIn+=c;if(!first)first=tx.timestamp;trades.push({type:"BUY",tok:a,usd:c,ts:tx.timestamp,sig:tx.signature,mint:tokenMint})}}
    if(tOut.length>0){const a=tOut.reduce((s,x)=>s+Math.abs(parseFloat(x.tokenAmount||0)),0);let r=vIn.reduce((s,x)=>s+Math.abs(parseFloat(x.tokenAmount||0))*(x.mint===SOL_MINT?150:1),0)+nIn.reduce((s,n)=>s+Math.abs(n.amount)/1e9*150,0);if(a>0){sells++;tokSell+=a;valOut+=r;trades.push({type:"SELL",tok:a,usd:r,ts:tx.timestamp,sig:tx.signature,mint:tokenMint})}}}
  const tot=buys+sells;const real=valOut-(tokSell>0&&tokBuy>0?valIn*(tokSell/tokBuy):0);
  const wr=sells>0?(trades.filter(t=>t.type==="SELL"&&t.usd>0).length/sells)*100:buys>0?0:null;
  const ah=first&&last?Math.abs(last-first)/3600:null;
  return{real:tot>0?real:null,valIn,valOut,tokBuy,tokSell,buys,sells,wr,ah,first,avgP:tokBuy>0?valIn/tokBuy:null,trades,tot,cost:valIn}}

function fullPnL(p,hold,price){if(!p||!price)return p;const hv=hold*price;const rc=p.tokBuy>0?p.cost*((p.tokBuy-p.tokSell)/p.tokBuy):0;const ur=hv-Math.max(rc,0);return{...p,hv,ur,total:(p.real||0)+ur,rc}}

// Extract ALL token movements from TXs for watchlist history
// Build mint→symbol from Helius enhanced TX descriptions
// Helius format: "WALLET swapped X.XX TOKEN_A for Y.YY TOKEN_B"
// or "WALLET transferred X TOKEN from WALLET to WALLET"
function buildMintMap(txs){
  const map=new Map();
  map.set(SOL_MINT,"SOL");
  map.set("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","USDC");
  map.set("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB","USDT");
  
  for(const tx of(txs||[])){
    const xfers=tx.tokenTransfers||[];
    const desc=tx.description||"";
    
    // Strategy 1: Match amounts in description to tokenTransfer amounts
    // "swapped 0.83 SOL for 45,700 OIIA0IIA" → extract number-symbol pairs
    const pairs=[];
    const re=/(?:^|[\s,])(\d[\d,.]*)\s+([A-Za-z][\w$]*)/g;
    let match;
    while((match=re.exec(desc))!==null){
      const num=parseFloat(match[1].replace(/,/g,""));
      const sym=match[2];
      if(num>0&&sym.length>=2&&sym.length<=20&&sym!=="from"&&sym!=="to"&&sym!=="for")
        pairs.push({num,sym});
    }
    
    // Match each tokenTransfer to a description pair by amount
    for(const x of xfers){
      if(!x.mint||map.has(x.mint))continue;
      const amt=Math.abs(parseFloat(x.tokenAmount||0));
      if(amt===0)continue;
      // Find matching pair (within 1% tolerance)
      for(const p of pairs){
        if(Math.abs(p.num-amt)/Math.max(amt,0.001)<0.02){
          map.set(x.mint,p.sym);break;
        }
      }
    }
    
    // Strategy 2: Check Helius events.swap if available
    if(tx.events?.swap){
      const sw=tx.events.swap;
      for(const t of[...(sw.tokenInputs||[]),...(sw.tokenOutputs||[])]){
        if(t.mint&&t.symbol&&!map.has(t.mint))map.set(t.mint,t.symbol);
      }
    }
  }
  return map;
}

function extractAllMoves(txs,wallet){
  const mintMap=buildMintMap(txs);
  const moves=[];
  for(const tx of(txs||[])){const xf=tx.tokenTransfers||[],nat=tx.nativeTransfers||[];
    for(const x of xf){
      const amt=Math.abs(parseFloat(x.tokenAmount||0));if(amt===0)continue;
      const isIn=x.toUserAccount===wallet;const isOut=x.fromUserAccount===wallet;if(!isIn&&!isOut)continue;
      let val=0;
      if(isIn){val=xf.filter(v=>(v.mint===SOL_MINT||STABLES.has(v.mint))&&v.fromUserAccount===wallet).reduce((s,v)=>s+Math.abs(parseFloat(v.tokenAmount||0))*(v.mint===SOL_MINT?150:1),0)+nat.filter(n=>n.fromUserAccount===wallet&&Math.abs(n.amount)>10000).reduce((s,n)=>s+Math.abs(n.amount)/1e9*150,0)}
      if(isOut){val=xf.filter(v=>(v.mint===SOL_MINT||STABLES.has(v.mint))&&v.toUserAccount===wallet).reduce((s,v)=>s+Math.abs(parseFloat(v.tokenAmount||0))*(v.mint===SOL_MINT?150:1),0)+nat.filter(n=>n.toUserAccount===wallet&&Math.abs(n.amount)>10000).reduce((s,n)=>s+Math.abs(n.amount)/1e9*150,0)}
      const sym=mintMap.get(x.mint)||`${x.mint.slice(0,6)}`;
      moves.push({dir:isIn?"IN":"OUT",type:tx.type||"UNKNOWN",mint:x.mint,sym,amt,val,priceEa:amt>0&&val>0?val/amt:null,ts:tx.timestamp,sig:tx.signature})}}
  moves.sort((a,b)=>(b.ts||0)-(a.ts||0));
  const seen=new Set();return moves.filter(m=>{const k=`${m.sig}-${m.mint}-${m.dir}`;if(seen.has(k))return false;seen.add(k);return true})}

function classify(h,all){const p=h.pct,fl=[];let lb="Holder",rs=0;
  if(p>10){lb="Whale";rs+=25;fl.push({s:"w",t:`${p.toFixed(2)}% — whale`})}
  else if(p>5){lb="Large";rs+=15;fl.push({s:"w",t:`${p.toFixed(2)}% — large`})}
  else if(p>2){lb="Mid";rs+=5}else if(p<0.01){lb="Dust";rs+=10}
  const pnl=h.pnlData;if(pnl&&pnl.tot>0){
    if(pnl.sells>pnl.buys*2&&pnl.sells>2){lb="Dumper";rs+=20;fl.push({s:"c",t:`${pnl.sells} sells vs ${pnl.buys} buys`})}
    else if(pnl.buys>0&&pnl.sells===0)fl.push({s:"g",t:"Diamond hands"});
    if(pnl.ah!=null&&pnl.ah<0.5&&pnl.tot>2){lb="Flipper";rs+=15;fl.push({s:"w",t:`${(pnl.ah*60).toFixed(0)}min hold`})}
    if(pnl.total!=null&&pnl.total>100)fl.push({s:"g",t:`+$${pnl.total.toFixed(0)} profit`});
    if(pnl.total!=null&&pnl.total<-50){rs+=10;fl.push({s:"w",t:`-$${Math.abs(pnl.total).toFixed(0)} loss`})}}
  if(h.txs?.length>2){const ts=h.txs.map(t=>t.timestamp).filter(Boolean).sort();if(ts.length>2){const g=[];for(let i=1;i<ts.length;i++)g.push(Math.abs(ts[i]-ts[i-1]));const a=g.reduce((a,b)=>a+b,0)/g.length;if(a<5){lb="Sniper Bot";rs+=35;fl.push({s:"c",t:"<5s gaps — bot"})}else if(a<20&&lb==="Holder"){lb="Fast Trader";rs+=10}}}
  if(h.owner?.startsWith("1111")){lb="Burn";rs=0;fl.length=0;fl.push({s:"g",t:"Burn"})}
  if(!fl.length)fl.push({s:"g",t:"Clean"});return{lb,rs:Math.min(rs,100),fl}}

function rugDNA(hs,sec){const t10=hs.slice(0,10).reduce((s,h)=>s+h.pct,0),t5=hs.slice(0,5).reduce((s,h)=>s+h.pct,0);let sc=0;const f=[];
  if(t10>70){sc+=35;f.push({s:"c",t:`Top 10: ${t10.toFixed(1)}%`})}else if(t10>50){sc+=20;f.push({s:"w",t:`Top 10: ${t10.toFixed(1)}%`})}else f.push({s:"g",t:`Top 10: ${t10.toFixed(1)}%`});
  if(t5>50){sc+=15;f.push({s:"c",t:`Top 5: ${t5.toFixed(1)}%`})}
  const wh=hs.filter(h=>h.pct>5).length;if(wh>3){sc+=15;f.push({s:"w",t:`${wh} >5%`})}
  const dm=hs.filter(h=>h.lb==="Dumper").length,bt=hs.filter(h=>h.lb==="Sniper Bot").length;
  if(dm>1){sc+=15;f.push({s:"c",t:`${dm} dumpers`})}if(bt>1){sc+=10;f.push({s:"w",t:`${bt} bots`})}
  const pr=hs.filter(h=>h.pnlData?.total>0).length,ls=hs.filter(h=>h.pnlData?.total!=null&&h.pnlData.total<0).length;
  if(pr+ls>0)f.push({s:"i",t:`${pr} profit, ${ls} losing`});
  if(sec){if(sec.isMintable){sc+=25;f.push({s:"c",t:"MINTABLE"})}if(sec.isFreezable){sc+=20;f.push({s:"c",t:"FREEZABLE"})}if(!sec.isMintable&&!sec.isFreezable)f.push({s:"g",t:"Safe: not mintable/freezable"})}
  if(sc<=10)f.unshift({s:"g",t:"No red flags"});sc=Math.min(sc,100);
  return{sc,lv:sc>60?"HIGH RISK":sc>30?"MEDIUM":"LOW RISK",f,st:{t10,t5,wh,bt,dm,pr,ls,n:hs.length,mint:sec?.isMintable||false,freeze:sec?.isFreezable||false}}}

const tr=(a,n=4)=>a?`${a.slice(0,n)}...${a.slice(-n)}`:"—";
const ago=ts=>{if(!ts)return"—";const s=Math.floor(Date.now()/1000-ts);if(s<0)return"now";if(s<60)return s+"s";if(s<3600)return Math.floor(s/60)+"m";if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d"};
const $u=n=>{if(n==null)return"—";const a=Math.abs(n),sg=n>=0?"+":"-";if(a>=1e6)return`${sg}$${(a/1e6).toFixed(2)}M`;if(a>=1e3)return`${sg}$${(a/1e3).toFixed(1)}K`;return`${sg}$${a.toFixed(2)}`};
const $v=n=>{if(n==null||isNaN(n))return"—";if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(1)}K`;return`$${parseFloat(n).toFixed(2)}`};
const pf=n=>n!=null?`${n>=0?"+":""}${parseFloat(n).toFixed(2)}%`:"—";
const fp=n=>{if(!n)return"—";if(n<1e-5)return`$${parseFloat(n).toExponential(2)}`;if(n<0.01)return`$${parseFloat(n).toFixed(6)}`;if(n<1)return`$${parseFloat(n).toFixed(4)}`;return`$${parseFloat(n).toFixed(2)}`};

const B=({text,color=C.g})=><span style={{display:"inline-block",padding:"2px 6px",fontSize:8.5,fontWeight:700,color,background:`${color}15`,border:`1px solid ${color}30`,borderRadius:3,letterSpacing:1,textTransform:"uppercase",whiteSpace:"nowrap"}}>{text}</span>;
const Dot=({color=C.g,label="LIVE"})=><span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color,letterSpacing:1.5}}><span style={{width:6,height:6,borderRadius:"50%",background:color,boxShadow:`0 0 8px ${color}`,animation:"pulse 2s ease-in-out infinite"}}/>{label}</span>;
const RBar=({score})=>{const co=score>60?C.r:score>30?C.y:C.g;return<div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:90,height:5,background:`${C.tM}33`,borderRadius:3,overflow:"hidden"}}><div style={{width:`${score}%`,height:"100%",borderRadius:3,background:`linear-gradient(90deg,${C.g},${score>30?C.y:C.g},${score>60?C.r:C.y})`}}/></div><span style={{fontSize:12,fontWeight:700,color:co}}>{score}/100</span></div>};
const St=({l,v,color=C.t,sm})=><div style={{textAlign:"center"}}><div style={{fontSize:sm?13:17,fontWeight:700,color}}>{v}</div><div style={{fontSize:8,color:C.tM,letterSpacing:1.5,marginTop:2}}>{l}</div></div>;
const KV=({k,v,color=C.t})=><div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:11}}><span style={{color:C.tS}}>{k}</span><span style={{color}}>{v}</span></div>;
const Ld=({text})=><div style={{textAlign:"center",padding:50}}><div style={{display:"inline-flex",gap:3,marginBottom:14}}>{[0,1,2,3,4,5,6].map(i=><div key={i} style={{width:3,height:20,background:C.g,borderRadius:1,animation:`pulse 0.8s ease ${i*0.1}s infinite`}}/>)}</div><div style={{fontSize:11,color:C.g,letterSpacing:3}}>{text}</div></div>;
const fc=s=>s==="c"?C.r:s==="w"?C.y:s==="g"?C.g:C.c;const fi=s=>s==="c"?"✖":s==="w"?"⚠":"✓";
const Spin=()=><span style={{display:"inline-block",width:8,height:8,border:`2px solid ${C.tM}`,borderTopColor:C.g,borderRadius:"50%",animation:"spin 0.6s linear infinite"}}/>;

function WRow({h,exp,onTog,onW,sym,tp:tokenPrice}){
  const rc=h.rs>60?C.r:h.rs>30?C.y:C.g;
  const lc=h.lb==="Sniper Bot"||h.lb==="Dumper"?C.r:h.lb==="Whale"?C.o:h.lb==="Flipper"?C.p:h.lb.includes("Trader")?C.y:h.lb==="Burn"?C.tM:C.c;
  const p=h.pnlData,hv=h.amt&&tokenPrice?h.amt*tokenPrice:null,tp2=p?.total,wr=p?.wr,ah=p?.ah,ld=h.enriching;
  return<div style={{background:exp?C.bgH:C.bgC,border:`1px solid ${exp?C.bdH:C.bd}`,borderRadius:5,marginBottom:3,cursor:"pointer"}}>
    <div onClick={onTog} style={{display:"grid",gridTemplateColumns:"28px 1.3fr 0.5fr 0.4fr 0.65fr 0.4fr 0.4fr 0.5fr 36px",alignItems:"center",padding:"7px 8px",gap:3}}>
      <span style={{fontSize:10,color:C.tM}}>#{h.rank}</span>
      <div style={{display:"flex",alignItems:"center",gap:4,overflow:"hidden"}}><span style={{fontSize:11,color:C.t}}>{tr(h.owner,5)}</span><B text={h.lb} color={lc}/></div>
      <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{h.pct.toFixed(2)}%</span>
      <span style={{fontSize:11,color:rc,textAlign:"right"}}>{h.rs}</span>
      <span style={{fontSize:11,textAlign:"right",color:tp2!=null?(tp2>=0?C.g:C.r):C.tM,fontWeight:600}}>{ld?<Spin/>:tp2!=null?$u(tp2):"—"}</span>
      <span style={{fontSize:11,textAlign:"right",color:wr!=null?(wr>=50?C.g:C.r):C.tM}}>{ld?<Spin/>:wr!=null?`${wr.toFixed(0)}%`:"—"}</span>
      <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{ld?<Spin/>:ah!=null?ah<1?`${(ah*60).toFixed(0)}m`:`${ah.toFixed(1)}h`:"—"}</span>
      <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{hv!=null?$v(hv):"—"}</span>
      <button onClick={e=>{e.stopPropagation();onW(h)}} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.tS,cursor:"pointer",padding:"2px 4px",fontSize:8,fontFamily:"inherit"}} onMouseEnter={e=>{e.target.style.color=C.g}} onMouseLeave={e=>{e.target.style.color=C.tS}}>+W</button>
    </div>
    {exp&&<ExpandedView h={h} sym={sym} tokenPrice={tokenPrice} hv={hv}/>}
  </div>;
}

function ExpandedView({h,sym,tokenPrice,hv}){
  const p=h.pnlData,tp2=p?.total;
  return<div style={{padding:"0 8px 12px",borderTop:`1px solid ${C.bd}`,display:"grid",gridTemplateColumns:"1fr 1.3fr",gap:12,animation:"fadeIn 0.2s"}}>
    <div style={{paddingTop:10}}>
      <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:6}}>WALLET</div>
      <KV k="Address" v={tr(h.owner,10)}/><KV k="SOL" v={h.sol!=null?`${h.sol.toFixed(3)} SOL`:"..."}/>
      <KV k="Holding" v={`${h.amt?.toLocaleString(undefined,{maximumFractionDigits:0})} ${sym}`}/>
      <KV k="Bag Value" v={hv!=null?$v(hv):"—"} color={C.g}/><KV k="% Supply" v={`${h.pct.toFixed(4)}%`}/>
      {p&&p.tot>0&&<>
        <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>P&L</div>
        <KV k="Total PnL" v={tp2!=null?$u(tp2):"—"} color={tp2>=0?C.g:C.r}/>
        <KV k="Realized" v={p.real!=null?$u(p.real):"—"} color={(p.real||0)>=0?C.g:C.r}/>
        <KV k="Unrealized" v={p.ur!=null?$u(p.ur):"—"} color={(p.ur||0)>=0?C.g:C.r}/>
        <KV k="Cost Basis" v={p.cost>0?$v(p.cost):"—"}/><KV k="Avg Buy" v={p.avgP?fp(p.avgP):"—"}/>
        <KV k="Win Rate" v={p.wr!=null?`${p.wr.toFixed(1)}%`:"—"} color={p.wr>=50?C.g:C.r}/>
        <KV k="Buys / Sells" v={`${p.buys} / ${p.sells}`}/><KV k="Avg Hold" v={p.ah!=null?p.ah<1?`${(p.ah*60).toFixed(0)}m`:`${p.ah.toFixed(1)}h`:"—"}/>
      </>}
      <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:6}}>FLAGS</div>
      {h.fl.map((f,i)=><div key={i} style={{display:"flex",gap:4,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
      <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginTop:10,marginBottom:4}}>LINKS</div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{[["Solscan",`https://solscan.io/account/${h.owner}`],["Birdeye",`https://birdeye.so/profile/${h.owner}?chain=solana`],["SolanaFM",`https://solana.fm/address/${h.owner}`]].map(([n,u])=><a key={n} href={u} target="_blank" rel="noopener noreferrer" style={{padding:"2px 7px",borderRadius:3,fontSize:9,color:C.g,background:C.gD,border:`1px solid ${C.g}30`}}>{n}↗</a>)}</div>
    </div>
    <div style={{paddingTop:10}}>
      <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:6}}>TOKEN ACTIVITY — {(h.txs||[]).length} TXs</div>
      <TokenMovesTable txs={h.txs} wallet={h.owner}/>
    </div>
  </div>;
}

function TokenMovesTable({txs,wallet}){
  const moves=extractAllMoves(txs||[],wallet);
  if(!moves.length)return<div style={{fontSize:10,color:C.tM,padding:10}}>No token movements found</div>;
  return<div>
    <div style={{display:"grid",gridTemplateColumns:"50px 55px 0.8fr 0.7fr 0.6fr 0.6fr 45px",padding:"3px 4px",fontSize:8,color:C.tM,letterSpacing:1,marginBottom:2,borderBottom:`1px solid ${C.bd}`}}>
      <span>DIR</span><span>TYPE</span><span>TOKEN</span><span style={{textAlign:"right"}}>AMOUNT</span><span style={{textAlign:"right"}}>VALUE</span><span style={{textAlign:"right"}}>PRICE</span><span style={{textAlign:"right"}}>WHEN</span>
    </div>
    {moves.slice(0,25).map((m,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"50px 55px 0.8fr 0.7fr 0.6fr 0.6fr 45px",padding:"3px 4px",marginBottom:1,borderRadius:3,background:i%2?`${C.bg}55`:"transparent",fontSize:10,alignItems:"center"}}>
      <B text={m.dir} color={m.dir==="IN"?C.g:C.r}/>
      <span style={{fontSize:9,color:m.type==="SWAP"?C.c:C.y,textTransform:"uppercase"}}>{m.type.length>8?m.type.slice(0,8):m.type}</span>
      <span style={{color:C.t,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.mint?<a href={`https://birdeye.so/token/${m.mint}?chain=solana`} target="_blank" rel="noopener noreferrer" style={{color:C.c,fontWeight:600}} onClick={e=>e.stopPropagation()}>{m.sym}</a>:m.sym}</span>
      <span style={{textAlign:"right",color:C.t}}>{m.amt>1e6?`${(m.amt/1e6).toFixed(1)}M`:m.amt>1e3?`${(m.amt/1e3).toFixed(1)}K`:m.amt.toFixed(2)}</span>
      <span style={{textAlign:"right",color:m.val>0?C.t:C.tM}}>{m.val>0?$v(m.val):"—"}</span>
      <span style={{textAlign:"right",color:C.tS}}>{m.priceEa?fp(m.priceEa):"—"}</span>
      <span style={{textAlign:"right",color:C.tM}}>{ago(m.ts)}</span>
    </div>)}
    {moves.length>25&&<div style={{fontSize:9,color:C.tM,textAlign:"center",padding:6}}>+{moves.length-25} more</div>}
  </div>;
}

function RDP({rd}){if(!rd)return null;const lc=rd.lv==="HIGH RISK"?C.r:rd.lv==="MEDIUM"?C.y:C.g;
  return<div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,padding:14,marginBottom:10}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}><div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:12,fontWeight:700,letterSpacing:1.5}}>RUG DNA</span><B text={rd.lv} color={lc}/></div><RBar score={rd.sc}/></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:4,marginBottom:10,padding:"8px 0",borderTop:`1px solid ${C.bd}`,borderBottom:`1px solid ${C.bd}`}}>
      <St l="TOP10%" v={`${rd.st.t10.toFixed(1)}%`} color={rd.st.t10>50?C.r:C.t} sm/><St l="TOP5%" v={`${rd.st.t5.toFixed(1)}%`} color={rd.st.t5>40?C.r:C.t} sm/>
      <St l="WHALES" v={rd.st.wh} color={rd.st.wh>3?C.o:C.t} sm/><St l="BOTS" v={rd.st.bt} color={rd.st.bt>1?C.r:C.t} sm/>
      <St l="DUMPERS" v={rd.st.dm} color={rd.st.dm>1?C.r:C.t} sm/><St l="PROFIT" v={rd.st.pr} color={C.g} sm/>
      <St l="LOSING" v={rd.st.ls} color={rd.st.ls>3?C.r:C.t} sm/><St l="MINT" v={rd.st.mint?"Y":"N"} color={rd.st.mint?C.r:C.g} sm/><St l="FREEZE" v={rd.st.freeze?"Y":"N"} color={rd.st.freeze?C.r:C.g} sm/>
    </div>
    {rd.f.map((f,i)=><div key={i} style={{display:"flex",gap:5,marginBottom:3,fontSize:10.5,color:fc(f.s)}}><span>{fi(f.s)}</span><span>{f.t}</span></div>)}
  </div>}

function TH({m}){if(!m)return null;const ch=m.priceChange24hPercent||0;
  return<div style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",gap:8,marginBottom:10,padding:12,background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:6,alignItems:"center"}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>{m.logoURI&&<img src={m.logoURI} alt="" style={{width:26,height:26,borderRadius:"50%"}}/>}<div><div style={{fontSize:13,fontWeight:700}}>{m.symbol||"—"}</div><div style={{fontSize:9,color:C.tM}}>{m.name}</div></div></div>
    <St l="PRICE" v={fp(m.price)}/><St l="MCAP" v={$v(m.mc||m.marketCap)}/><St l="24H VOL" v={$v(m.v24hUSD)}/><St l="LIQ" v={$v(m.liquidity)}/><St l="24H" v={pf(ch)} color={ch>=0?C.g:C.r}/>
  </div>}

function VTab(){const[addr,sA]=useState("");const[ld,sL]=useState(false);const[d,sD]=useState(null);const[err,sE]=useState("");
  const scan=async()=>{if(!addr.trim())return;sL(true);sE("");sD(null);try{const[bal,txs,port]=await Promise.all([getSolBal(addr),getTxs(addr),getPortfolio(addr)]);
    const tok=(port||[]).filter(t=>t.valueUsd>0.01).sort((a,b)=>(b.valueUsd||0)-(a.valueUsd||0));const tv=tok.reduce((s,t)=>s+(t.valueUsd||0),0);
    const ty={};(txs||[]).forEach(tx=>{const t=tx.type||"?";ty[t]=(ty[t]||0)+1});const fl=[{s:"g",t:"Scanned"}];
    const moves=extractAllMoves(txs||[],addr);
    sD({addr,bal,txs:txs||[],tok,tv,fl,ty,moves})}catch(e){sE(e.message)}sL(false)};
  return<div>
    <div style={{display:"flex",gap:8,marginBottom:20}}>
      <input value={addr} onChange={e=>sA(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="Paste wallet..." style={{flex:1,padding:"11px 14px",background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,color:C.t,fontFamily:"inherit",fontSize:12,outline:"none"}} onFocus={e=>e.target.style.borderColor=C.g} onBlur={e=>e.target.style.borderColor=C.bd}/>
      <button onClick={scan} disabled={ld} style={{padding:"11px 24px",background:"transparent",border:`1px solid ${C.g}`,borderRadius:5,color:C.g,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:ld?"wait":"pointer",letterSpacing:2}}>{ld?"...":"DEEP SCAN"}</button>
    </div>
    {ld&&<Ld text="SCANNING..."/>}
    {d&&!ld&&<div style={{animation:"fadeIn 0.3s"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>{[["SOL",d.bal.toFixed(3),C.t],["PORTFOLIO",$v(d.tv),C.t],["TOKENS",d.tok.length,C.t],["TXS",d.txs.length,C.c]].map(([l,v,c])=><div key={l} style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:11,textAlign:"center"}}><div style={{fontSize:17,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:8,color:C.tM,marginTop:3}}>{l}</div></div>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}><div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>TOP HOLDINGS</div>
          {d.tok.slice(0,15).map((t,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 4px",fontSize:10.5,borderRadius:3,background:i%2?`${C.bg}55`:"transparent"}}><div style={{display:"flex",gap:4,alignItems:"center"}}>{t.logoURI&&<img src={t.logoURI} alt="" style={{width:14,height:14,borderRadius:"50%"}}/>}<span style={{color:C.t,fontWeight:600}}>{t.symbol||"?"}</span></div><span style={{color:C.t}}>{$v(t.valueUsd)}</span></div>)}</div>
        <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}><div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>TX TYPES</div>
          {Object.entries(d.ty).sort((a,b)=>b[1]-a[1]).map(([t,c])=><KV key={t} k={t} v={c}/>)}</div>
      </div>
      <div style={{background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,padding:14}}><div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>TOKEN ACTIVITY — {d.moves.length} movements</div><TokenMovesTable txs={d.txs} wallet={d.addr}/></div>
    </div>}
  </div>}

function WL({wl,onRm,tokenPrice,sym,tokenMint}){
  const[wExp,setWExp]=useState(null);
  if(!wl.length)return<div style={{textAlign:"center",padding:60}}><div style={{fontSize:28,opacity:.2,marginBottom:8}}>👁</div><div style={{fontSize:11,color:C.tS}}>No wallets watched</div></div>;
  return<div>
    <div style={{fontSize:9,color:C.tM,letterSpacing:2,marginBottom:8}}>WATCHED — {wl.length}</div>
    <div style={{display:"grid",gridTemplateColumns:"28px 1.3fr 0.5fr 0.4fr 0.65fr 0.4fr 0.4fr 0.5fr 36px",padding:"4px 8px",gap:3,fontSize:8,color:C.tM,letterSpacing:1.2,borderBottom:`1px solid ${C.bd}`,marginBottom:3}}>
      <span>#</span><span>WALLET</span><span style={{textAlign:"right"}}>HOLD%</span><span style={{textAlign:"right"}}>RISK</span><span style={{textAlign:"right"}}>PnL</span><span style={{textAlign:"right"}}>WIN%</span><span style={{textAlign:"right"}}>HOLD</span><span style={{textAlign:"right"}}>BAG$</span><span></span>
    </div>
    {wl.map((w,i)=>{const p=w.pnlData,tp2=p?.total,wr=p?.wr,ah=p?.ah,rc=w.rs>60?C.r:w.rs>30?C.y:C.g;
      const lc=w.lb==="Sniper Bot"||w.lb==="Dumper"?C.r:w.lb==="Whale"?C.o:w.lb==="Flipper"?C.p:C.c;
      const hv=w.amt&&tokenPrice?w.amt*tokenPrice:null;const isX=wExp===w.owner;
      return<div key={i} style={{background:isX?C.bgH:C.bgC,border:`1px solid ${isX?C.bdH:C.bd}`,borderRadius:5,marginBottom:3,cursor:"pointer"}}>
        <div onClick={()=>setWExp(isX?null:w.owner)} style={{display:"grid",gridTemplateColumns:"28px 1.3fr 0.5fr 0.4fr 0.65fr 0.4fr 0.4fr 0.5fr 36px",alignItems:"center",padding:"7px 8px",gap:3}}>
          <span style={{fontSize:10,color:C.tM}}>#{i+1}</span>
          <div style={{display:"flex",alignItems:"center",gap:4,overflow:"hidden"}}><span style={{fontSize:11,color:C.t}}>{tr(w.owner,5)}</span><B text={w.lb} color={lc}/></div>
          <span style={{fontSize:11,color:C.t,textAlign:"right"}}>{w.pct.toFixed(2)}%</span>
          <span style={{fontSize:11,color:rc,textAlign:"right"}}>{w.rs}</span>
          <span style={{fontSize:11,textAlign:"right",color:tp2!=null?(tp2>=0?C.g:C.r):C.tM,fontWeight:600}}>{tp2!=null?$u(tp2):"—"}</span>
          <span style={{fontSize:11,textAlign:"right",color:wr!=null?(wr>=50?C.g:C.r):C.tM}}>{wr!=null?`${wr.toFixed(0)}%`:"—"}</span>
          <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{ah!=null?ah<1?`${(ah*60).toFixed(0)}m`:`${ah.toFixed(1)}h`:"—"}</span>
          <span style={{fontSize:10,textAlign:"right",color:C.tS}}>{hv!=null?$v(hv):"—"}</span>
          <button onClick={e=>{e.stopPropagation();onRm(i)}} style={{background:"none",border:`1px solid ${C.bd}`,borderRadius:3,color:C.r,cursor:"pointer",padding:"2px 4px",fontSize:8,fontFamily:"inherit"}}>X</button>
        </div>
        {isX&&<ExpandedView h={w} sym={sym} tokenPrice={tokenPrice} hv={hv}/>}
      </div>})}
  </div>}

export default function Signal(){
  const[tab,setTab]=useState("discover");const[ca,setCa]=useState("");const[ld,setLd]=useState(false);
  const[hl,setHl]=useState([]);const[rd,setRd]=useState(null);const[tm,setTm]=useState(null);
  const[exp,setExp]=useState(null);const[wl,setWl]=useState([]);
  const[sort,setSort]=useState("rank");const[filt,setFilt]=useState("ALL");
  const[msg,setMsg]=useState("");const[err,setErr]=useState("");
  const[enr,setEnr]=useState(0);const[enrT,setEnrT]=useState(0);const[sec,setSec]=useState(null);

  const enrich=async(hs,idx,mint,tp)=>{const h=hs[idx];if(!h)return;try{
    const[bal,txs]=await Promise.all([getSolBal(h.owner),getTxs(h.owner)]);
    hs[idx].sol=bal;hs[idx].txs=txs||[];hs[idx].enriching=false;
    let p=parseTxPnL(txs||[],mint,h.owner);p=fullPnL(p,h.amt,tp);hs[idx].pnlData=p;
    const rc=classify(hs[idx],hs);hs[idx].lb=rc.lb;hs[idx].rs=rc.rs;hs[idx].fl=rc.fl;
  }catch{hs[idx].enriching=false}};

  const discover=async()=>{if(!ca.trim())return;setLd(true);setErr("");setHl([]);setRd(null);setTm(null);setExp(null);setEnr(0);
    try{setMsg("Token...");const[ov,sc]=await Promise.all([getOverview(ca),getSecurity(ca)]);if(ov)setTm(ov);setSec(sc);const tp=ov?.price||0;
      setMsg("Holders...");const raw=await getHolders(ca);if(!raw?.length){setErr("No holders");setLd(false);return}
      const tot=raw.reduce((s,h)=>s+h.amt,0);
      const hs=raw.map((h,i)=>({...h,rank:i+1,pct:tot>0?(h.amt/tot)*100:0,txs:[],sol:null,pnlData:null,enriching:true,fl:[],lb:"Holder",rs:0}));
      for(const h of hs){const c=classify(h,hs);h.lb=c.lb;h.rs=c.rs;h.fl=c.fl}
      setHl([...hs]);setRd(rugDNA(hs,sc));setLd(false);
      const n=hs.length;setEnrT(n);
      for(let b=0;b<n;b+=5){await Promise.all(Array.from({length:Math.min(5,n-b)},(_,i)=>enrich(hs,b+i,ca,tp)));setEnr(Math.min(b+5,n));setHl([...hs]);setRd(rugDNA(hs,sc))}
      for(const h of hs)h.enriching=false;setHl([...hs]);setEnrT(0);
    }catch(e){setErr(e.message);setLd(false)}};

  const sorted=[...hl].sort((a,b)=>sort==="rank"?a.rank-b.rank:sort==="risk"?b.rs-a.rs:sort==="pnl"?(b.pnlData?.total||0)-(a.pnlData?.total||0):b.pct-a.pct).filter(h=>filt==="ALL"||h.lb===filt);
  const labels=["ALL",...new Set(hl.map(h=>h.lb))];const tp=tm?.price||0;

  return<div style={{minHeight:"100vh",background:C.bg,color:C.t,fontFamily:"'JetBrains Mono','Fira Code',monospace"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes glow{0%,100%{box-shadow:0 0 8px ${C.gG}}50%{box-shadow:0 0 20px ${C.gG}}}@keyframes spin{to{transform:rotate(360deg)}}::selection{background:${C.g}25}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:${C.bd};border-radius:3px}input::placeholder{color:${C.tM}}a{text-decoration:none}`}</style>
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:90,background:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,255,136,0.004) 3px,rgba(0,255,136,0.004) 4px)"}}/>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",borderBottom:`1px solid ${C.bd}`,background:`${C.bgS}dd`,backdropFilter:"blur(10px)",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:3,height:24,background:C.g,borderRadius:1,animation:"glow 3s ease infinite"}}/><div><div style={{fontSize:16,fontWeight:800,letterSpacing:7}}>SIGNAL</div><div style={{fontSize:8,letterSpacing:3,color:C.g,marginTop:-2}}>WALLET INTELLIGENCE</div></div></div>
      <div style={{display:"flex",alignItems:"center",gap:12}}><Dot/>{enrT>0&&<Dot color={C.y} label={`${enr}/${enrT}`}/>}</div>
    </header>
    <main style={{maxWidth:1500,margin:"0 auto",padding:"16px 20px"}}>
      <div style={{display:"flex",gap:3,marginBottom:18}}>{[{id:"discover",l:"DISCOVER",s:"Token → Wallets"},{id:"validate",l:"VALIDATE",s:"Wallet → Intel"},{id:"watchlist",l:"WATCHLIST",s:`${wl.length} tracked`}].map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"9px 22px",background:tab===t.id?C.bgH:"transparent",border:`1px solid ${tab===t.id?C.g:C.bd}`,borderRadius:5,cursor:"pointer",fontFamily:"inherit"}}><div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:tab===t.id?C.g:C.tS}}>{t.l}</div><div style={{fontSize:8,color:tab===t.id?C.gM:C.tM,marginTop:1}}>{t.s}</div></button>)}</div>

      {tab==="discover"&&<div style={{animation:"fadeIn 0.2s"}}>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={ca} onChange={e=>setCa(e.target.value)} onKeyDown={e=>e.key==="Enter"&&discover()} placeholder="Paste Solana token mint..." style={{flex:1,padding:"11px 14px",background:C.bgC,border:`1px solid ${C.bd}`,borderRadius:5,color:C.t,fontFamily:"inherit",fontSize:12,outline:"none"}} onFocus={e=>e.target.style.borderColor=C.g} onBlur={e=>e.target.style.borderColor=C.bd}/>
          <button onClick={discover} disabled={ld} style={{padding:"11px 24px",background:"transparent",border:`1px solid ${C.g}`,borderRadius:5,color:C.g,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:ld?"wait":"pointer",letterSpacing:2,minWidth:150}}>{ld?"SCANNING...":"FIND WALLETS"}</button>
        </div>
        {err&&<div style={{color:C.r,fontSize:11,marginBottom:10,padding:"8px 12px",background:C.rD,borderRadius:4}}>{err}</div>}
        {ld&&<Ld text={msg}/>}
        {!ld&&hl.length>0&&<div style={{animation:"fadeIn 0.3s"}}>
          <TH m={tm}/><RDP rd={rd}/>
          {enrT>0&&<div style={{fontSize:10,color:C.y,marginBottom:6}}>⟳ {enr}/{enrT} enriched...</div>}
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:6}}>
            <div style={{display:"flex",gap:3}}><span style={{fontSize:9,color:C.tM,letterSpacing:2,marginRight:4}}>SORT</span>{[["rank","RANK"],["risk","RISK↓"],["pnl","PnL↓"],["pct","%↓"]].map(([k,l])=><button key={k} onClick={()=>setSort(k)} style={{padding:"2px 7px",fontSize:9,fontFamily:"inherit",background:sort===k?C.gD:"transparent",border:`1px solid ${sort===k?C.g:C.bd}`,color:sort===k?C.g:C.tS,borderRadius:3,cursor:"pointer"}}>{l}</button>)}</div>
            <div style={{display:"flex",gap:2,flexWrap:"wrap"}}><span style={{fontSize:9,color:C.tM,letterSpacing:2,marginRight:4}}>FILTER</span>{labels.map(l=><button key={l} onClick={()=>setFilt(l)} style={{padding:"2px 6px",fontSize:8,fontFamily:"inherit",background:filt===l?C.cD:"transparent",border:`1px solid ${filt===l?C.c:C.bd}`,color:filt===l?C.c:C.tS,borderRadius:3,cursor:"pointer"}}>{l}</button>)}</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"28px 1.3fr 0.5fr 0.4fr 0.65fr 0.4fr 0.4fr 0.5fr 36px",padding:"4px 8px",gap:3,fontSize:8,color:C.tM,borderBottom:`1px solid ${C.bd}`,marginBottom:3}}>
            <span>#</span><span>WALLET</span><span style={{textAlign:"right"}}>HOLD%</span><span style={{textAlign:"right"}}>RISK</span><span style={{textAlign:"right"}}>TOTAL PnL</span><span style={{textAlign:"right"}}>WIN%</span><span style={{textAlign:"right"}}>HOLD</span><span style={{textAlign:"right"}}>BAG$</span><span></span>
          </div>
          {sorted.map(h=><WRow key={h.tAcc} h={h} sym={tm?.symbol||""} tp={tp} exp={exp===h.owner} onTog={()=>setExp(exp===h.owner?null:h.owner)} onW={w=>{if(!wl.find(x=>x.owner===w.owner))setWl([...wl,w])}}/>)}
          <div style={{textAlign:"center",padding:10,fontSize:9,color:C.tM}}>{sorted.length} wallets • {hl.filter(h=>h.pnlData?.total>0).length} profitable • {hl.filter(h=>h.rs>50).length} flagged</div>
        </div>}
        {!ld&&!hl.length&&!err&&<div style={{textAlign:"center",padding:60}}><div style={{fontSize:36,opacity:.2,marginBottom:12}}>⚡</div><div style={{fontSize:11,color:C.tS,letterSpacing:2}}>PASTE TOKEN MINT</div></div>}
      </div>}
      {tab==="validate"&&<div style={{animation:"fadeIn 0.2s"}}><VTab/></div>}
      {tab==="watchlist"&&<div style={{animation:"fadeIn 0.2s"}}><WL wl={wl} onRm={i=>setWl(wl.filter((_,x)=>x!==i))} tokenPrice={tp} sym={tm?.symbol||""} tokenMint={ca}/></div>}
    </main>
    <footer style={{padding:"12px 20px",borderTop:`1px solid ${C.bd}`,display:"flex",justifyContent:"space-between",marginTop:20}}><span style={{fontSize:9,color:C.tM}}>SIGNAL v3.4</span><span style={{fontSize:9,color:C.tM}}>Helius + Birdeye • Per-trade history</span></footer>
  </div>}
