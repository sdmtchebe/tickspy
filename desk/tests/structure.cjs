const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../structure-engine.js');
const fixture=(n=180)=>Array.from({length:n},(_,i)=>{const c=100+Math.sin(i/5)*2+i*.02;return{t:new Date(1700000000000+i*60000).toISOString(),o:c-.1,h:c+.5,l:c-.5,c,v:1000+i}});
test('history is unchanged when future bars are appended',()=>{
 const bars=fixture(),full=E.indicators(bars);
 for(const n of [80,100,150])assert.deepEqual(E.indicators(bars.slice(0,n)),full.slice(0,n));
});
test('flat, zero-volume input is finite and has no invented levels',()=>{
 const b=fixture().map(v=>({...v,o:100,h:100,l:100,c:100,v:0})),r=E.analyze(b);
 assert.equal(r.current.adx,0);assert.equal(r.current.efficiency,0);assert.equal(r.current.change,null);
 assert.equal(r.current.bwRank,50);assert.equal(r.levels.vwap,null);assert.equal(r.levels.zones.length,0);
 assert(Object.values(r.current).filter(v=>typeof v==='number').every(Number.isFinite));
});
test('ranks use midrank ties and known order statistics',()=>{assert.equal(E.percentile(3,[1,2,3,4]),62.5);assert.equal(E.percentile(2,[2,2]),50)});
test('confirmed pivots wait for their right-side bars',()=>{
 const b=[1,2,3,5,3,2,1].map((c,i)=>({...fixture(7)[i],o:c,h:c+.1,l:c-.1,c}));
 assert.equal(E.keyLevels(b.slice(0,6),1).points.length,0);
 assert.equal(E.keyLevels(b,1).points[0].i,3);
});
test('VWAP and initial ATR agree with hand calculations',()=>{
 assert.equal(E.keyLevels([{h:12,l:8,c:10,v:100},{h:22,l:18,c:20,v:300}],1).vwap,17.5);
 const b=fixture().map(v=>({...v,o:100,c:100,h:101,l:99}));assert.equal(E.indicators(b)[13].atr,2);
});
test('monotonic trend has efficiency one and bullish classification',()=>{
 const b=fixture().map((v,i)=>({...v,o:100+i,h:101.2+i,l:99.8+i,c:101+i}));
 const c=E.analyze(b).current;assert.equal(c.efficiency,1);assert.equal(c.regime,'Bullish trend');
});
test('invalid bars and settings fail explicitly',()=>{
 const b=fixture();assert.throws(()=>E.analyze(b.slice(0,76)));assert.doesNotThrow(()=>E.analyze(b.slice(0,77)));assert.throws(()=>E.analyze([b[0],b[0],...b.slice(2)]));
 assert.throws(()=>E.analyze([{...b[0],h:0},...b.slice(1)]));assert.throws(()=>E.analyze(b,{radius:0}));
});
test('completed-bar selection excludes unfinished intervals and replay future',()=>{
 const b=fixture(100),cut=Date.parse(b[80].t);
 assert.equal(E.completedBars(b,'1Min',cut).length,80);
 assert.equal(E.completedBars(b,'5Min',cut).length,76);
 assert.equal(E.completedBars(b,'1Min',cut-1).length,79);
 assert.equal(E.completedBars(b,'1Min',Date.parse(b[0].t)-1).length,0);
 assert.throws(()=>E.completedBars(b,'garbage',cut));
});
test('input prices and source arrays are not mutated',()=>{
 const b=fixture(),saved=JSON.stringify(b);E.analyze(b);const filtered=E.completedBars(b,'1Min',Infinity);filtered[0].c=999;
 assert.equal(JSON.stringify(b),saved);
});
test('keyless 15-minute bars use exact, completed three-bar groups',()=>{
 const source=fixture(90).map((b,i)=>({...b,t:new Date(1700000100000+i*300000).toISOString()}));
 const start=Date.parse(source[0].t),aligned=Math.floor(start/900000)*900000;
 // Start on a quarter hour to make the first 3 source bars one full group.
 const bars=source.map((b,i)=>({...b,t:new Date(aligned+i*300000).toISOString()}));
 const cutoff=Date.parse(bars[5].t)+300000;
 const aggregated=E.freeBars(bars,[], '15Min',cutoff,'2026-10-09');
 assert.equal(aggregated.length,2);
 assert.deepEqual(aggregated[0],{t:bars[0].t,o:bars[0].o,h:Math.max(...bars.slice(0,3).map(b=>b.h)),l:Math.min(...bars.slice(0,3).map(b=>b.l)),c:bars[2].c,v:bars.slice(0,3).reduce((s,b)=>s+b.v,0)});
 assert.equal(E.freeBars(bars,[], '15Min',cutoff-1,'2026-10-09').length,1);
 const gapped=bars.filter((_,i)=>i!==4);
 assert.equal(E.freeBars(gapped,[],'15Min',Infinity,'2026-10-09').length,29);
 assert.equal(E.freeBars(bars,[],'5Min',cutoff,'2026-10-09').length,6);
});
test('keyless daily analysis uses daily history only through the completed session',()=>{
 const intraday=fixture(180),daily=fixture(90).map((b,i)=>({...b,t:new Date(Date.UTC(2026,0,1+i)).toISOString(),c:500+i}));
 const result=E.freeBars(intraday,daily,'1Day',Date.now(),'2026-03-25');
 assert(result.length>=77&&result.length<daily.length);
 assert.equal(result.at(-1).c,500+result.length-1);
 assert.equal(result[0].t,daily[0].t);
 assert.throws(()=>E.freeBars(intraday,daily,'1Hour',Date.now(),'2026-03-15'));
});
test('multiple symbol-like price scales produce finite outputs and no cross-symbol state',()=>{
 for(const price of [2,20,500,2500]){
   const bars=fixture().map(b=>({...b,o:b.o*price/100,h:b.h*price/100,l:b.l*price/100,c:b.c*price/100}));
   const result=E.analyze(bars);
   assert(result.current.ready);
   assert(Number.isFinite(result.current.adx));
   assert(result.levels.zones.every(z=>z.low>0&&z.high>z.low));
 }
});
