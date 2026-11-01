const assert = require('node:assert/strict');
const assistant = require('../assistant.js');
const Free = require('../freesrc.js');

async function main() {
  const settings = assistant.normalize({symbols:'spy, NVDA SPY',tf:'5Min',time:'08:00',interval:15,sections:['news','patterns'],priority:'news'});
  assert.deepEqual(settings.symbols,['SPY','NVDA']);
  assert.throws(()=>assistant.normalize({...settings,symbols:'bad!'}),/valid US symbols/);
  assert.throws(()=>assistant.normalize({...settings,priority:'volume'}),/must also be selected/);
  assert.equal(assistant.due(settings,'',new Date(2026,9,31,7,59)),false);
  assert.equal(assistant.due(settings,'',new Date(2026,9,31,8,0)),true);
  assert.equal(assistant.due(settings,'2026-10-31',new Date(2026,9,31,22)),false);
  assert.equal(assistant.due(settings,'2026-10-30',new Date(2026,9,31,9)),true);

  const now=Date.parse('2026-10-31T13:00:00Z');
  const bar=(t,v=10)=>({t,o:100,h:102,l:99,c:101,v});
  const intraday=[bar('2026-10-30T14:00:00Z'),bar('2026-10-31T12:58:00Z'),bar('2026-10-31T13:00:00Z')];
  assert.equal(assistant.cleanBars(intraday,'5Min',now).length,1,'drops forming candles');
  assert.equal(assistant.cleanBars([bar('2026-10-30T13:30:00Z'),bar('2026-10-31T13:30:00Z')],'1Day',now).length,1,'drops today daily candle');
  assert.equal(assistant.cleanBars([bar('2026-10-30T14:00:00Z',-1)],'5Min',now).length,0,'drops bad volume');
  const items=assistant.mergeNews([], [{id:'x',title:'NVDA',url:'javascript:alert(1)',publishedAt:now-1000},{id:'x',title:'NVDA duplicate',publishedAt:now-1000},{id:'old',title:'old',publishedAt:now-4*86400000},{id:'undated',title:'undated'}],now,{stale:true});
  assert.equal(items.length,1); assert.equal(items[0].url,''); assert.equal(items[0].cache.stale,true);

  const fields={};
  const elem=id=>fields[id]||(fields[id]={value:'',checked:false,textContent:'',innerHTML:'',classList:{toggle(){},contains(){return false}},setAttribute(){}});
  const flags=['patterns','volatility','volume','research','news','calendar'].map(value=>({value,checked:true}));
  let badgeUnread=false; const button=elem('navbutton');
  button.classList.toggle=(name,on)=>{if(name==='assistant-unread')badgeUnread=on};
  const listeners={};
  global.document={hidden:true,getElementById:elem,querySelector:s=>s.startsWith('#nav')?button:null,querySelectorAll:s=>s.includes(':checked')?flags.filter(f=>f.checked):flags,addEventListener:(n,f)=>{listeners[n]=f}};
  global.addEventListener=()=>{};
  const originalInterval=global.setInterval; global.setInterval=()=>0;
  const store={};
  let fail=true;
  const previous=new Date(Date.now()-3*86400000).toISOString().slice(0,10);
  const daily=[];
  for(let i=120;i>=1;i--){const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10);daily.push(bar(d+'T14:30:00Z',1000+i));}
  const calls=[];
  const api=async path=>{
    calls.push(path); if(fail)throw Error('offline');
    if(path.includes('symbol=BAD'))throw Error('No data for that symbol');
    if(path.startsWith('/api/news'))return {news:[{id:'one',title:'Nvidia update',url:'https://example.com/a',source:'Feed',publishedAt:Date.now()-60000}],sourcesOk:1,sourcesTotal:1,fetchedAt:new Date().toISOString(),cache:{ageSeconds:0}};
    if(path.startsWith('/api/calendar'))return {events:[{country:'USD',title:'CPI',date:new Date(Date.now()+3600000).toISOString(),impact:'High'}]};
    if(path.startsWith('/api/bars'))return {bars:daily,source:'yahoo',sessionDate:previous,cache:{ageSeconds:60}};
    if(path.startsWith('/api/research/market'))return {available:true,asOf:previous,brief:{headline:'Market context',blocks:[]}};
    if(path.startsWith('/api/research/brief'))return {available:true,asOf:previous,source:'yahoo',brief:{headline:'Daily context',blocks:[],dataGaps:[]},model:{band:{p10:.01,p90:.03},backtest:{coverage:{80:.75},sessions:20}}};
    throw Error('unexpected endpoint '+path);
  };
  assistant.init({storage:store,edgeGet:api,alp:async()=>{throw Error('unexpected Alpaca call')},cfg:()=>({}),free:Free,structure:{analyze:()=>({current:{regime:'Mixed',phase:'No compression',atrPct:1,atrRank:20}})},patterns:()=>({candles:[{n:'Doji',i1:119}],charts:[]}),watchlist:()=>['NVDA']});
  elem('assistant-symbols').value='NVDA, BAD';elem('assistant-tf').value='1Day';elem('assistant-time').value='23:59';elem('assistant-interval').value='15';elem('assistant-priority').value='patterns';
  // A first attempt with all sources offline must not look like a built briefing.
  elem('assistant-form').onsubmit({preventDefault(){}});
  await waitUntil(()=>elem('assistant-status').textContent.includes('unavailable'));
  assert.match(elem('assistant-output').innerHTML,/Attempted/);
  assert.match(elem('assistant-output').innerHTML,/No briefing could be built/);
  assert.equal(store['assistant-report-v1'],undefined);
  // A single-symbol failure must not prevent a useful partial report.
  fail=false; elem('assistant-refresh').onclick();
  await waitUntil(()=>store['assistant-report-v1']);
  let report=JSON.parse(store['assistant-report-v1']);
  assert.equal(report.rows.length,2); assert.equal(report.rows[0].symbol,'NVDA'); assert.match(report.rows[1].sections.patterns.error,/No data/);
  assert.equal(report.rows[0].sections.news.items[0].title,'Nvidia update');
  assert.equal(report.rows[0].sections.volume.ratio>0,true);
  assert.equal(report.rows[0].sections.research.model.backtest.coverage[80],.75);
  assert.ok(elem('assistant-output').innerHTML.includes('Market-wide research'));
  assert.ok(elem('assistant-output').innerHTML.includes('Historical walk-forward coverage: 75%'));
  assert.equal(badgeUnread,true,'background report is unread');
  assistant.open(); assert.equal(badgeUnread,false); assert.equal(JSON.parse(store['assistant-report-v1']).unread,false);
  fail=true; elem('assistant-refresh').onclick();
  await waitUntil(()=>elem('assistant-status').textContent.includes('unavailable'));
  assert.equal(JSON.parse(store['assistant-report-v1']).createdAt,report.createdAt,'failure keeps last report');
  assert.ok(calls.some(p=>p.includes('/api/research/market')));
  global.setInterval=originalInterval;
  console.log('assistant checks passed');
}
async function waitUntil(fn) {for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('timed out waiting for assistant');}
main().catch(e=>{console.error(e);process.exitCode=1});
