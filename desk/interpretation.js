/* Descriptive interpretation of the desk's current OHLCV calculations.
 * This module does not fetch data or produce signals; it explains the values
 * the desk already calculates. Inputs may include an unfinished live bar. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;else root.DeskInterpretation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const finite=Number.isFinite, fmt=n=>finite(n)?Number(n).toFixed(2):'unavailable';
 const row=(title,result,meaning,use)=>({title,result,meaning,use});
 const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
 const candleMeaning={
  'Doji':'The candle opened and closed close together relative to its range.',
  'Hammer':'A long lower wick appeared after a decline under the desk’s rule.',
  'Shooting star':'A long upper wick appeared after a rise under the desk’s rule.',
  'Bullish marubozu':'A large upward candle has little wick.',
  'Bearish marubozu':'A large downward candle has little wick.',
  'Bullish engulfing':'The upward candle’s body covers the preceding downward body.',
  'Bearish engulfing':'The downward candle’s body covers the preceding upward body.',
  'Morning star':'The desk found a downward candle, a smaller body and an upward candle.',
  'Evening star':'The desk found an upward candle, a smaller body and a downward candle.',
  'Three white soldiers':'Three upward candles closed progressively higher.',
  'Three black crows':'Three downward candles closed progressively lower.'
 };
 const chartMeaning={
  'Double top':'Two recent peaks are close in price.',
  'Double bottom':'Two recent troughs are close in price.',
  'Head and shoulders':'Three recent peaks have a higher middle peak and similar outer peaks.',
  'Inverse head and shoulders':'Three recent troughs have a lower middle trough and similar outer troughs.',
  'Uptrend (higher highs and lows)':'The last three detected peaks and troughs each rose.',
  'Downtrend (lower highs and lows)':'The last three detected peaks and troughs each fell.',
  'Ascending triangle':'The recent peaks are roughly level while troughs rise.',
  'Descending triangle':'The recent troughs are roughly level while peaks fall.',
  'Symmetrical triangle':'The recent peaks fall while troughs rise.',
  'Range breakout up':'The last bar close is above the previous 20 bars’ highest high.',
  'Range breakdown':'The last bar close is below the previous 20 bars’ lowest low.'
 };
 function summary(bars,a){
  if(!a||!Array.isArray(bars)||bars.length<40)return [row('Combined read','Not enough data','At least 40 bars are needed to interpret this selection.','Wait for data or select a timeframe with more history.')];
  const e9=a.e9?.at(-1),e21=a.e21?.at(-1),p=a.p,old=bars.at(-6)?.c,vol=bars.slice(-25).map(b=>b.v);
  const trend=finite(e9)&&finite(e21)&&finite(p)?`EMA 9 is ${e9>e21?'above':e9<e21?'below':'equal to'} EMA 21; the close is ${p>e21?'above':p<e21?'below':'at'} EMA 21.`:'The EMA comparison is unavailable.';
  const movement=finite(old)&&old>0&&finite(p)?` The close changed ${fmt((p/old-1)*100)}% over the last five bars.`:'';
  const previous=vol.length===25&&vol.every(v=>finite(v)&&v>=0)?mean(vol.slice(0,20)):null;
  const activity=previous>0?` The last five bars averaged ${fmt(mean(vol.slice(-5))/previous)}× the preceding 20 bars’ volume.`:' Relative volume is unavailable.';
  const all=[...(a.cp||[]),...(a.chp||[])],up=all.some(x=>x.s>0),down=all.some(x=>x.s<0);
  const matches=all.length?` The desk detected ${all.length} pattern match${all.length===1?'':'es'}${up&&down?', including both positive- and negative-labelled shapes':''}.`:' No named pattern matched the current window.';
  return [row('Combined read',`${fmt(p)} last bar close`,trend+movement+activity+matches,'Compare the indicator values and pattern locations below, especially when they disagree. Their labels are descriptive and do not establish the probability of the next move.')];
 }
 function volume(bars,a,tf){
  if(!a||!Array.isArray(bars)||bars.length<40)return [row('Volume','Not enough data','At least 40 bars are needed for the desk’s analysis.','Try a timeframe with more history or wait for data to load.')];
  const v=bars.slice(-25).map(b=>b.v),valid=v.length===25&&v.every(x=>finite(x)&&x>=0),recent=valid?mean(v.slice(-5)):null,prior=valid?mean(v.slice(0,20)):null,ratio=prior>0?recent/prior:null;
  const out=[row('Relative volume',ratio==null?'Unavailable':`${fmt(ratio)}× · recent five-bar average ${fmt(recent)} vs prior 20-bar average ${fmt(prior)}`,
   ratio==null?'The prior 20-bar average is zero or volume data is missing, so a comparison cannot be calculated.':ratio>=1.3?'Recent volume is at least 1.3× the preceding 20-bar average under the desk’s threshold.':ratio<0.8?'Recent volume is below 0.8× the preceding 20-bar average.':'Recent volume is between 0.8× and 1.3× the preceding 20-bar average. The 0.8× and 1.3× bands are descriptive cutoffs, not validated trading signals.',
   'Compare activity alongside price movement, not as proof of buying or selling. Intraday activity varies by time of day; this baseline is not time-of-day adjusted.')];
  const vwap=finite(a.vwap)&&a.vwap>0?a.vwap:null,p=a.p;
  out.push(row('Volume-weighted reference',vwap==null?'Unavailable':`Last bar close ${fmt(p)} · reference ${fmt(vwap)}`,
   vwap==null?'Volume is absent or insufficient to calculate the reference.':tf==='1Day'?'For daily bars this is the bar’s typical price, not a session VWAP.':`The last bar close is ${p>vwap?'above':p<vwap?'below':'at'} the loaded session’s approximate VWAP. It uses each bar’s typical price, not individual trades.`,
   'Use this as a reference to the loaded bars, not a guaranteed support or resistance level. The feed may cover only one exchange.'));
  const ob=a.metrics?.obT;
  const obVolume=bars.slice(-10).every(b=>finite(b.v)&&b.v>=0)&&bars.slice(-10).some(b=>b.v>0);
  out.push(row('On-balance volume · 10 bars',!finite(ob)||!obVolume?'Unavailable':`${ob>0?'Rising':ob<0?'Falling':'Unchanged'} · net ${Math.round(ob).toLocaleString()} shares`,
   !finite(ob)||!obVolume?'The required volume data is missing or zero.':'The desk adds volume on higher closes and subtracts it on lower closes; this is the change in that running total over ten bars.',
   'Compare it with the price path for context. It does not identify who bought or sold and can diverge from price without predicting a reversal.'));
  return out;
 }
 function indicators(a,bars,tf){
  if(!a||!a.metrics)return [row('Indicators','Not enough data','At least 40 bars are needed for the desk’s analysis.','Try a timeframe with more history or wait for data to load.')];
  const m=a.metrics,p=a.p,last=x=>Array.isArray(x)?x.at(-1):null, e9=last(a.e9),e21=last(a.e21), vwap=a.vwap;
  const defs={
   'Trend (EMA 9 vs 21)': [finite(e9)&&finite(e21)&&finite(p)?`The 9-bar EMA is ${e9>e21?'above':e9<e21?'below':'equal to'} the 21-bar EMA; the close is ${p>e21?'above':p<e21?'below':'at'} the 21-bar EMA.`:'EMA comparison unavailable.', 'Compare the close and both averages for context; moving averages lag and can cross repeatedly in a range.'],
   'VWAP': [finite(vwap)&&vwap>0?`The last close is ${p>vwap?'above':p<vwap?'below':'at'} the desk’s approximate volume-weighted reference.`:'Unavailable: the volume-weighted reference needs non-zero volume.', 'It is estimated from loaded bars, not a guarantee of support or resistance; daily-bar output is a typical price rather than a session VWAP.'],
   'RSI (14)': [finite(m.rsi)?`RSI is ${fmt(m.rsi)}: ${m.rsi>70?'above 70':m.rsi<30?'below 30':'between 30 and 70'}.`:'RSI unavailable.', 'High or low momentum can persist; an extreme does not by itself establish a reversal.'],
   'MACD histogram': [finite(m.macd)&&finite(m.macdPrior)?`The histogram is ${m.macd>0?'positive':m.macd<0?'negative':'zero'} and ${m.macd>m.macdPrior?'higher':m.macd<m.macdPrior?'lower':'unchanged'} versus the previous bar.`:'MACD unavailable.', 'Compare its change with the price trend; it is a lagging transformation of price, not independent confirmation.'],
   'Bollinger %B': [m.bandWidthValid&&finite(m.pb)?`The close is ${m.pb>1?'above the upper band':m.pb<0?'below the lower band':'between the bands'} (%B ${fmt(m.pb)}).`:'Unavailable because the band width is zero or invalid.', 'Band positions describe recent dispersion; prices can remain outside a band.'],
   'Relative volume': ['See the volume interpretation: it compares the latest five bars with the preceding 20.', 'A volume spike is activity, not evidence of direction; compare like times of day.'],
   'On-balance volume (10 bars)': ['See the volume interpretation for the 10-bar change in signed bar volume.', 'Compare its direction with price, but do not treat it as actual order flow.'],
   'ATR (14)': [finite(a.atr)&&finite(p)&&p>0?`The average true range is ${fmt(a.atr)}, or ${fmt(a.atr/p*100)}% of the close, per bar.`:'ATR unavailable.', 'Use it to understand the recent scale of movement, not its direction.'],
   'ADX (14)': [finite(m.adx)?`ADX is ${fmt(m.adx)} (${m.adx>=25?'at or above 25':m.adx<20?'below 20':'between 20 and 25'}); +DI ${fmt(m.pdi)} and −DI ${fmt(m.ndi)}.`:'ADX unavailable.', 'ADX describes trend strength, not direction; compare the DI values and remember the threshold is a heuristic.'],
   'Stochastic (14,3)': [m.rangeValid&&finite(m.stoch)?`%K is ${fmt(m.stoch)}: ${m.stoch>80?'above 80':m.stoch<20?'below 20':'between 20 and 80'}.`:'Unavailable because the recent high-low range is zero.', 'This locates the close in its recent range; extreme readings can persist.'],
   'CCI (20)': [m.cciValid&&finite(m.cci)?`CCI is ${fmt(m.cci)}: ${m.cci>100?'above +100':m.cci< -100?'below −100':'between −100 and +100'}.`:'Unavailable because the recent typical prices have no variation.', 'It measures distance from an average; an extreme is not an automatic reversal.'],
   'Williams %R (14)': [m.rangeValid&&finite(m.willr)?`Williams %R is ${fmt(m.willr)}: ${m.willr> -20?'above −20':m.willr< -80?'below −80':'between −80 and −20'}.`:'Unavailable because the recent high-low range is zero.', 'Like stochastic, it describes the close within a recent range, not a forecast.'],
   'MFI (14)': [m.mfiValid&&finite(m.mfi)?`MFI is ${fmt(m.mfi)}: ${m.mfi>80?'above 80':m.mfi<20?'below 20':'between 20 and 80'}.`:'Unavailable because recent price and volume do not provide usable money flow.', 'This volume-weighted momentum measure can remain extreme; feed coverage affects it.'],    'Keltner / squeeze': [`The desk’s band-width comparison is ${m.squeeze?'on':'off'}.`, 'A narrow band relative to the channel describes compression, not a guaranteed breakout or its direction.']
  };
  const volumeRows=volume(bars,a,tf);
  return (a.it||[]).map(x=>{
   if(x.n==='Relative volume')return volumeRows[0];
   if(x.n==='On-balance volume (10 bars)')return volumeRows[2];
   const d=defs[x.n]||['The desk calculated this value from the loaded bars.','Use it alongside its underlying data.'];const unavailable=d[0].startsWith('Unavailable')||d[0].endsWith('unavailable.');return row(x.n,unavailable?'Unavailable':x.val,d[0],d[1]);});
 }
 function patterns(a){
  if(!a)return [row('Patterns','Not enough data','At least 40 bars are needed for the desk’s pattern rules.','Try a timeframe with more history or wait for data to load.')];
  const seen=new Set(),candles=(a.cp||[]).filter(p=>!seen.has(p.n)&&seen.add(p.n)).slice(0,5),charts=(a.chp||[]).slice(0,5);
  const out=[];
  for(const p of candles)out.push(row('Candlestick · '+p.n,`${p.age?`${p.age} bars ago`:'latest bar'}${p.time?' · '+p.time+' ET':''}`,candleMeaning[p.n]||'A shape matched the desk’s candle rule.','Inspect the marked bars and surrounding trend and volume. A pattern alone does not establish the next move.'));
  for(const p of charts){let meaning=chartMeaning[p.n]||'A shape matched the desk’s chart rule.';
   if(p.n==='Double top'||p.n==='Double bottom')meaning+=Math.abs(p.s)===1?' The desk’s close-based break condition was met.':' The desk’s close-based break condition was not met.';
   out.push(row('Chart · '+p.n,'Detected in the last 150 bars',meaning,'Inspect the marked pivots and any relevant breakout level. Pattern rules can disagree or fail; no outcome is guaranteed.'));
  }
  if(!candles.length)out.push(row('Candlestick patterns','None detected','The desk checks the latest six bars against its named candle rules.','No match does not mean there is no meaningful price movement.'));
  if(!charts.length)out.push(row('Chart patterns','None detected','The desk checks up to 150 bars against its named chart rules.','A different window or rule can produce a different result.'));
  return out;
 }
 return {summary,volume,indicators,patterns};
});
