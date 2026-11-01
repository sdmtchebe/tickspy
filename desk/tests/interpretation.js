const assert = require('node:assert/strict');
const interpret = require('../interpretation.js');

const bars = Array.from({length:40},(_,i)=>({t:new Date(2026,0,1,9,i),o:100,h:102,l:99,c:100+i*.1,v:i>=35?200:100}));
const names=['Trend (EMA 9 vs 21)','VWAP','RSI (14)','MACD histogram','Bollinger %B','Relative volume','On-balance volume (10 bars)','ATR (14)','ADX (14)','Stochastic (14,3)','CCI (20)','Williams %R (14)','MFI (14)','Keltner / squeeze'];
const a={p:103.9,atr:3,vwap:101,e9:[102],e21:[101],it:names.map(n=>({n,val:n==='VWAP'?'101.00':'value'})),cp:[{n:'Doji',age:0,time:'10:00'},{n:'Doji',age:1}],chp:[{n:'Double top',s:-.5}],metrics:{rsi:75,macd:1,macdPrior:.5,pb:1.1,bandWidthValid:true,adx:30,pdi:25,ndi:12,stoch:85,cci:105,willr:-10,mfi:82,squeeze:true,obT:400,rangeValid:true,cciValid:true,mfiValid:true}};
const rows=interpret.volume(bars,a,'5Min');
assert.match(rows[0].result,/2\.00×/);
assert.match(rows[0].meaning,/at least 1\.3×/);
assert.match(rows[0].use,/not time-of-day adjusted/);
assert.match(rows[1].meaning,/above/);
assert.match(rows[2].result,/Rising/);
assert.match(interpret.summary(bars,a)[0].meaning,/2\.00×/);
const indicators=interpret.indicators(a,bars,'5Min');
assert.equal(indicators.length,14);
assert.match(indicators.find(x=>x.title==='RSI (14)').meaning,/above 70/);
assert.match(indicators.find(x=>x.title==='MACD histogram').meaning,/positive and higher/);
assert.match(indicators.find(x=>x.title==='ADX (14)').meaning,/30\.00/);
assert.match(indicators.find(x=>x.title==='Relative volume').result,/2\.00×/);
let patterns=interpret.patterns(a);
assert.equal(patterns.filter(x=>x.title.includes('Doji')).length,1);
assert.match(patterns.find(x=>x.title.includes('Double top')).meaning,/not met/);
assert.match(interpret.patterns({...a,chp:[{n:'Double top',s:-1}],cp:[]}).find(x=>x.title.includes('Double top')).meaning,/was met/);
assert.match(interpret.patterns({...a,cp:[],chp:[]})[0].result,/None detected/);
assert.match(interpret.volume([],null,'5Min')[0].result,/Not enough/);
const zero=bars.map(x=>({...x,v:0}));
const missing=interpret.volume(zero,{...a,vwap:NaN},'1Day');
assert.equal(missing[0].result,'Unavailable'); assert.equal(missing[1].result,'Unavailable'); assert.equal(missing[2].result,'Unavailable');
const invalid=interpret.indicators({...a,vwap:NaN,metrics:{...a.metrics,bandWidthValid:false,rangeValid:false,cciValid:false,mfiValid:false}},zero,'1Day');
for(const name of ['VWAP','Bollinger %B','Stochastic (14,3)','CCI (20)','Williams %R (14)','MFI (14)','Relative volume'])assert.equal(invalid.find(x=>x.title===name).result,'Unavailable',name);
assert.match(interpret.volume(bars,a,'1Day')[1].meaning,/not a session VWAP/);

// Run the actual desk analyzer rather than a second implementation, then
// verify that its values are the ones presented by the interpreter.
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/i.test(match[1])&&match[2].trim())new vm.Script(match[2]);
const start=html.indexOf('/* ---------- math ---------- */'),end=html.indexOf('/* The interpreter shares the exact calculations');
assert.ok(start>=0&&end>start);
const ctx={S:{bars,mode:'live'},avg:x=>x.reduce((a,b)=>a+b,0)/(x.length||1),f2:n=>n==null||!Number.isFinite(n)?'--':n.toFixed(2),ET:()=> '10:00'};
vm.runInNewContext(html.slice(start,end)+'\nanalyze();',ctx);
const actual=ctx.S.an;
assert.ok(actual&&actual.metrics);
assert.match(interpret.volume(bars,actual,'5Min')[0].result,/2\.00×/);
const rsi=interpret.indicators(actual,bars,'5Min').find(x=>x.title==='RSI (14)');
assert.equal(rsi.result,actual.it.find(x=>x.n==='RSI (14)').val);
assert.ok(interpret.patterns(actual).length>0);

// Exercise the actual pattern button code against a DOM, including redraws,
// switching between patterns, and rolling bar windows.
const {JSDOM}=require('../../frontend/node_modules/jsdom');
const dom=new JSDOM('<div class="left"><div class="panel"></div></div><div id="patterns"></div>');
const document=dom.window.document;
let draws=0;
const patternContext={document,S:{bars:bars.map(b=>({...b})),view:{n:20,end:0},focus:null},draw:()=>draws++,esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
const patternStart=html.indexOf('function patternSelected('),patternEnd=html.indexOf('/* The on-ramp.',patternStart);
assert.ok(patternStart>=0&&patternEnd>patternStart);
vm.runInNewContext(html.slice(patternStart,patternEnd),patternContext);
const first={n:'Doji',i0:30,i1:32},second={n:'Double top',i0:25,i1:35};
const paint=()=>{document.getElementById('patterns').innerHTML=patternContext.patternButton(first)+patternContext.patternButton(second)};
paint();let buttons=document.querySelectorAll('[data-show]');
buttons[0].click();assert.equal(buttons[0].textContent,'Hide');assert.equal(buttons[0].getAttribute('aria-pressed'),'true');assert.equal(patternContext.S.focus.name,'Doji');
paint();buttons=document.querySelectorAll('[data-show]');assert.equal(buttons[0].textContent,'Hide');
buttons[1].click();assert.equal(buttons[0].textContent,'Show on chart');assert.equal(buttons[1].textContent,'Hide');assert.equal(patternContext.S.focus.name,'Double top');
buttons[1].click();assert.equal(buttons[1].textContent,'Show on chart');assert.equal(patternContext.S.focus,null);
buttons[0].click();patternContext.S.bars=patternContext.S.bars.slice(1);
patternContext.reconcilePatternFocus({cp:[{...first,i0:29,i1:31}],chp:[]});
assert.equal(patternContext.S.focus.i0,29);assert.equal(patternContext.S.focus.i1,31);
patternContext.reconcilePatternFocus({cp:[],chp:[]});assert.equal(patternContext.S.focus,null);
paint();document.querySelector('[data-show]').click();
patternContext.reconcilePatternFocus({cp:[{...first,i0:31,i1:33},{...first}],chp:[]});
assert.equal(patternContext.S.focus,null,'clear an older duplicate when only the newest is shown');assert.ok(draws>=5);
assert.match(html,/S\.sessionDate=null;S\.mtfRows=null;S\.rs=null;S\.focus=null/);
assert.match(html,/\$\('#cvclear'\)\.onclick=\(\)=>\{S\.focus=null;draw\(\);patternButtonsSync\(\)\}/);
const research=fs.readFileSync(path.join(__dirname,'../research.js'),'utf8');
assert.match(research,/<details class="rmethod"><summary>How this is calculated<\/summary>/);
assert.match(html,/\.rmethod summary\{/);
console.log('interpreter and pattern checks passed');
