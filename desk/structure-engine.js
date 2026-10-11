/* Pure market-structure calculations, adapted from the standalone Structure Lab.
   Public statistical methods; thresholds are descriptive heuristics, not calibrated odds. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DeskStructure=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
 const sd=xs=>{const m=mean(xs);return Math.sqrt(mean(xs.map(x=>(x-m)**2)))};
 const percentile=(x,h)=>h.length?100*(h.filter(v=>v<x).length+h.filter(v=>v===x).length/2)/h.length:null;
 function completedBars(bars,tf,cutoff){
   const durations={ '1Min':60000,'5Min':300000,'15Min':900000,'1Hour':3600000,'1Day':86400000 };
   const duration=durations[tf];
   if(!duration)throw Error('This timeframe is not supported by Market Structure.');
   if(!Number.isFinite(cutoff)&&cutoff!==Infinity)throw Error('The replay cutoff is unavailable.');
   return bars.filter(b=>new Date(b.t).getTime()+duration<=cutoff).map(b=>({...b,t:new Date(b.t).toISOString()}));
 }
 // The keyless bundle contains 5-minute bars plus a separate daily series.
 // Never relabel 5-minute observations as a larger timeframe. A 15-minute bar
 // requires three adjacent, fully completed 5-minute source bars.
 function freeBars(intraday,daily,tf,cutoff,sessionDate){
   if(tf==='1Day')return completedBars((daily||[]).filter(b=>
     !sessionDate||new Date(b.t).toISOString().slice(0,10)<=sessionDate
   ),'1Day',Infinity);
   const complete=completedBars(intraday||[],'5Min',cutoff);
   if(tf==='5Min')return complete;
   if(tf!=='15Min')throw Error('This keyless timeframe is not supported by Market Structure.');
   const grouped=[];let bucket=null,part=[];
   function flush(){
     if(part.length!==3)return;
     const start=Date.parse(part[0].t);
     if(part.every((b,i)=>Date.parse(b.t)===start+i*300000))grouped.push({
       t:part[0].t,o:part[0].o,h:Math.max(...part.map(b=>b.h)),
       l:Math.min(...part.map(b=>b.l)),c:part[2].c,v:part.reduce((sum,b)=>sum+b.v,0)
     });
   }
   for(const b of complete){const start=Math.floor(Date.parse(b.t)/900000)*900000;
     if(start!==bucket){flush();bucket=start;part=[]}part.push(b)
   }
   flush();return grouped;
 }
 function validate(bars){
   if(!Array.isArray(bars)||bars.length<77||bars.length>5000)throw Error('Market Structure needs 77–5,000 completed bars.');
   let last=-Infinity;
   bars.forEach((b,i)=>{
     const t=new Date(b.t).getTime();
     if(!Number.isFinite(t)||t<=last)throw Error(`Bar ${i+1}: times must be valid, unique and increasing.`);
     if(!['o','h','l','c','v'].every(k=>Number.isFinite(b[k]))||Math.min(b.o,b.h,b.l,b.c)<=0||b.v<0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c))throw Error(`Bar ${i+1}: the source returned inconsistent price or volume data.`);
     last=t;
   });
 }
 function indicators(bars){
   let ema=bars[0].c,atr=0,plus=0,minus=0,adx=null,upperSum=0,lowerSum=0;
   const dxs=[],trs=[],ups=[],downs=[],out=[],returns=[];
   bars.forEach((b,i)=>{
     const prev=bars[i-1]||b,tr=Math.max(b.h-b.l,Math.abs(b.h-prev.c),Math.abs(b.l-prev.c));
     const up=i?b.h-prev.h:0,down=i?prev.l-b.l:0;
     trs.push(tr);ups.push(up>down&&up>0?up:0);downs.push(down>up&&down>0?down:0);
     ema+=2/21*(b.c-ema);
     if(i===13){atr=mean(trs);plus=mean(ups);minus=mean(downs)}
     if(i>13){atr=(13*atr+tr)/14;plus=(13*plus+ups[i])/14;minus=(13*minus+downs[i])/14}
     if(i>=13){dxs.push(plus+minus>0?100*Math.abs(plus-minus)/(plus+minus):0);if(dxs.length===14)adx=mean(dxs);if(dxs.length>14)adx=(adx*13+dxs.at(-1))/14}
     const r=i?Math.log(b.c/prev.c):0,prior=returns.slice(-30),sigma=prior.length===30?sd(prior):0;
     const z=sigma>1e-12?(r-mean(prior))/sigma:0;
     returns.push(r);upperSum=Math.max(0,upperSum+z-0.5);lowerSum=Math.min(0,lowerSum+z+0.5);
     const change=sigma>1e-12?upperSum>5?'Upward shift':lowerSum< -5?'Downward shift':null:null;
     const cusumUp=upperSum,cusumDown=lowerSum;if(change){upperSum=0;lowerSum=0}
     const closes=bars.slice(Math.max(0,i-19),i+1).map(v=>v.c),mid=mean(closes),s=sd(closes),bandwidth=4*s/mid*100;
     const atrPct=atr/b.c*100,rv=sd(returns.slice(-20))*100,history=out.slice(-100).filter(v=>v.i>=26);
     const bwRank=percentile(bandwidth,history.map(v=>v.bandwidth)),atrRank=percentile(atrPct,history.map(v=>v.atrPct));
     const ready=history.length>=50,squeeze=i>=26&&mid+2*s<ema+1.5*atr&&mid-2*s>ema-1.5*atr;
     const path=closes.slice(1).reduce((a,c,j)=>a+Math.abs(c-closes[j]),0),efficiency=path>0?Math.abs(b.c-closes[0])/path:0;
     const slope=i>=5&&atr>0?(ema-out[i-5].ema)/atr:0;
     let regime='Warming up';
     if(ready)regime=adx>=25&&efficiency>=0.3&&Math.abs(slope)>=0.15?(slope>0?'Bullish trend':'Bearish trend'):atrRank>=80&&efficiency<0.3?'Volatile chop':bwRank<=20&&atrRank<=30?'Compression':'Mixed / range';
     const priorSqueeze=out.slice(-5).some(v=>v.squeeze);
     const phase=!ready?'Warming up':squeeze&&bwRank<=20?'Deep compression':squeeze?'Squeeze active':priorSqueeze&&bandwidth>(out.at(-1)?.bandwidth||0)?'Squeeze release':bwRank>=80&&bandwidth>(out.at(-1)?.bandwidth||0)?'Expanding':'No compression';
     out.push({i,ema,atr,atrPct,adx,efficiency,slope,bandwidth,bwRank,atrRank,rv,mid,upper:mid+2*s,lower:mid-2*s,kcUpper:ema+1.5*atr,kcLower:ema-1.5*atr,squeeze,ready,regime,phase,change,z,cusumUp,cusumDown});
   });return out;
 }
 function keyLevels(bars,atr,{radius=3,width=0.6}={}){
   if(![3,5,8].includes(radius)||![0.3,0.6,1].includes(width))throw Error('Choose a supported pivot radius and zone width.');
   const start=Math.max(0,bars.length-240),points=[];
   for(let i=Math.max(start,radius);i<bars.length-radius;i++){
     const neighbours=bars.slice(i-radius,i+radius+1);
     if(neighbours.every((b,k)=>k===radius||b.h<bars[i].h))points.push({price:bars[i].h,i,type:'Swing high'});
     if(neighbours.every((b,k)=>k===radius||b.l>bars[i].l))points.push({price:bars[i].l,i,type:'Swing low'});
   }
   const bandwidth=Math.max(atr*width,bars.at(-1).c*0.0001),clusters=[];
   for(const p of points.sort((a,b)=>a.price-b.price)){let cluster=clusters.at(-1);if(!cluster||p.price-cluster[0].price>bandwidth){cluster=[];clusters.push(cluster)}cluster.push(p)}
   const last=bars.at(-1).c;
   const zones=clusters.map(ps=>{
     const weights=ps.map(p=>Math.exp(-(bars.length-1-p.i)/100)),weight=weights.reduce((a,b)=>a+b,0),price=ps.reduce((a,p,i)=>a+p.price*weights[i],0)/weight;
     return{price,low:Math.min(...ps.map(p=>p.price))-bandwidth/4,high:Math.max(...ps.map(p=>p.price))+bandwidth/4,pivots:ps.length,weight,latest:Math.max(...ps.map(p=>p.i)),sources:[...new Set(ps.map(p=>p.type))].join(' + ')};
   }).sort((a,b)=>b.weight-a.weight).slice(0,6).sort((a,b)=>b.price-a.price);
   zones.forEach(z=>z.side=last>z.high?'Support candidate':last<z.low?'Resistance candidate':'Inside zone');
   const anchor=Math.max(0,bars.length-120),window=bars.slice(anchor),volume=window.reduce((a,b)=>a+b.v,0);
   const vwap=volume?window.reduce((a,b)=>a+(b.h+b.l+b.c)/3*b.v,0)/volume:null;
   return{zones,bandwidth,radius,anchor,vwap,points};
 }
  function study(bars,series,horizon=5){
    if(![1,5,10,20].includes(horizon))throw Error('Unsupported study horizon.');
    const observations=[];
    // Shared, non-overlapping time grid across regimes. Each label uses only
    // its prefix; an outcome is included only when the full horizon is present.
    for(let i=76;i+horizon<bars.length;i+=horizon){if(!series[i].ready)continue;
      observations.push({index:i,end:i+horizon,regime:series[i].regime,ret:100*(bars[i+horizon].c/bars[i].c-1)});
    }
    const describe=xs=>{const sorted=xs.map(x=>x.ret).sort((a,b)=>a-b),n=sorted.length;return{n,mean:n?mean(sorted):null,median:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null,positive:n?100*sorted.filter(x=>x>0).length/n:null}};
    return{horizon,observations,baseline:describe(observations),groups:[...new Set(observations.map(x=>x.regime))].map(regime=>({regime,...describe(observations.filter(x=>x.regime===regime))}))};
  }
  function analyze(bars,options){validate(bars);const series=indicators(bars);return{series,current:series.at(-1),levels:keyLevels(bars,series.at(-1).atr,options)}}
   return{analyze,indicators,keyLevels,percentile,completedBars,freeBars,validate,study};
});
