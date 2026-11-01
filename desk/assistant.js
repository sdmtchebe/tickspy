/* Personalized briefing: local settings and observed headlines, no generated advice.
 * Price analysis uses completed bars; daily research is a separate edge result.
 * Timers are best-effort, so startup, online and visibility changes also catch up.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DeskAssistant = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SECTIONS = ['patterns', 'volatility', 'volume', 'research', 'news', 'calendar'];
  const LABELS = {patterns:'Patterns',volatility:'Volatility',volume:'Volume',research:'Research',news:'News',calendar:'Economic calendar'};
  const TF = { '1Min':'1 minute', '5Min':'5 minutes', '15Min':'15 minutes', '1Day':'1 day' };
  const CFG = 'assistant-settings-v1', REPORT = 'assistant-report-v1', NEWS = 'assistant-news-v1', SCHEDULE = 'assistant-schedule-v1';
  const MAX_SYMBOLS = 8, MAX_NEWS = 250;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const fmt = n => Number.isFinite(n) ? n.toFixed(2) : 'unavailable';
  const dateTime = t => { if(t==null || t==='')return 'time unavailable'; const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'time unavailable'; };
  const localDay = d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  const etDay = t => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const input = Array.isArray(raw.symbols) ? raw.symbols : String(raw.symbols || '').split(/[\s,]+/);
    const symbols = [...new Set(input.map(x => String(x).trim().toUpperCase()).filter(Boolean))];
    if (!symbols.length || symbols.length > MAX_SYMBOLS || symbols.some(s => !/^[A-Z][A-Z0-9.-]{0,9}$/.test(s))) throw Error('Enter 1–8 valid US symbols, separated by commas.');
    const sections = Array.isArray(raw.sections) ? SECTIONS.filter(s => raw.sections.includes(s)) : [];
    if (!sections.length) throw Error('Choose at least one section.');
    if (!sections.includes(raw.priority)) throw Error('The first section must also be selected.');
    if (!TF[raw.tf] || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) || ![15,30,60].includes(Number(raw.interval))) throw Error('Choose a valid timeframe, briefing time and news interval.');
    return {symbols,sections,priority:raw.priority,tf:raw.tf,time:raw.time,interval:Number(raw.interval)};
  }
  function due(settings, scheduledDay, now) {
    if (!settings) return false;
    const [h,m] = settings.time.split(':').map(Number);
    return scheduledDay !== localDay(now) && now.getHours()*60 + now.getMinutes() >= h*60+m;
  }
  function sinceYesterday(now) { const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate()-1); return d.getTime(); }
  function newsTime(n) { return typeof n.publishedAt === 'number' ? n.publishedAt : Date.parse(n.publishedAt); }
  function mergeNews(old, incoming, now, meta) {
    const by = new Map();
    for (const n of [...(Array.isArray(old) ? old : []), ...(Array.isArray(incoming) ? incoming.map(x => ({...x, observedAt:now, cache:meta})) : [])]) {
      if (!n || !n.title || !Number.isFinite(newsTime(n)) || newsTime(n) < sinceYesterday(new Date(now)) || newsTime(n) > now) continue;
      const key = String(n.id || n.url || n.title);
      if (!by.has(key)) by.set(key, {id:key,title:String(n.title).slice(0,500),summary:String(n.summary||'').slice(0,400),url:safeUrl(n.url),source:String(n.source||'Unknown'),publishedAt:newsTime(n),observedAt:n.observedAt,cache:n.cache||null});
    }
    return [...by.values()].sort((a,b)=>b.publishedAt-a.publishedAt).slice(0, MAX_NEWS);
  }
  function cleanBars(bars, tf, now, sessionDate) {
    const today = etDay(now), durations = {'1Min':60000,'5Min':300000,'15Min':900000};
    return (Array.isArray(bars) ? bars : []).filter(b => {
      const t = Date.parse(b.t);
      if (!Number.isFinite(t) || !['o','h','l','c','v'].every(k => Number.isFinite(b[k])) || b.c<=0 || b.o<=0 || b.l<=0 || b.h<Math.max(b.o,b.c) || b.l>Math.min(b.o,b.c) || b.v<0) return false;
      if (tf === '1Day') return etDay(t) < today;
      return t + durations[tf] <= now && (!sessionDate || etDay(t) <= sessionDate);
    }).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
  }
  function cacheLabel(c) { return c && c.stale ? ' · stale cached copy' : c && Number.isFinite(c.ageSeconds) ? ` · cache age ${Math.round(c.ageSeconds/60)} min` : ''; }
  function errorMessage(e) {
    if (e?.name === 'AbortError') return 'The data request timed out. Please try again.';
    const message = String(e?.message || e);
    return /failed to fetch|networkerror|load failed/i.test(message) ? 'Could not reach the data source. Check your connection or service availability.' : message;
  }
  function section(title, content, id) { return `<div class="rgroup"${id?` id="${esc(id)}"`:''}><div class="rhead"><b>${esc(title)}</b></div>${content}</div>`; }
  function text(s) { return `<p class="x">${esc(s)}</p>`; }
  function empty(s) { return text('Unavailable: ' + s); }
  let ctx, settings, report, storedNews, schedule, busy = false, polling = null, pending = false, retryPending = false, lastPoll = 0, nextRetry = 0, version = 0;
  const $ = id => document.getElementById(id);
  const read = (key, fallback) => { try { const x = JSON.parse(ctx.storage[key] || 'null'); return x == null ? fallback : x; } catch (_) { return fallback; } };
  const save = (key, value) => { ctx.storage[key] = JSON.stringify(value); };
  function status(s) { const el=$('assistant-status'); if(el) el.textContent=s; }
  function badge() {
    const btn = document.querySelector('#nav button[data-k="assistant"]'); if (!btn) return;
    const unread = !!(report && report.unread);
    btn.classList.toggle('assistant-unread', unread);
    btn.textContent = unread ? 'Assistant · New' : 'Assistant';
    btn.setAttribute('aria-label', unread ? 'Assistant, new briefing available' : 'Assistant');
  }
  function isOpen() { return !!document.getElementById('t-assistant')?.classList.contains('on'); }
  function open() { if (report && report.unread) {report.unread=false; save(REPORT,report);} badge(); render(); }
  function form() {
    if (!settings) return;
    $('assistant-symbols').value=settings.symbols.join(', '); $('assistant-tf').value=settings.tf; $('assistant-time').value=settings.time; $('assistant-interval').value=String(settings.interval); $('assistant-priority').value=settings.priority;
    document.querySelectorAll('#assistant-sections input').forEach(el=>{el.checked=settings.sections.includes(el.value)});
  }
  async function pollNews() {
    if (!settings || !settings.sections.includes('news')) return;
    if(polling) { await polling; if(!settings || !settings.sections.includes('news'))return; }
    const generation=version; lastPoll=Date.now();
    const request=(async()=>{
      try {
        const j=await ctx.edgeGet('/api/news',15000);
        if (!Array.isArray(j.news) || !Number.isFinite(j.sourcesOk) || j.sourcesOk < 1) throw Error('No news sources responded.');
        if(generation!==version)return;
        storedNews=mergeNews(storedNews,j.news,Date.now(),{stale:!!j.cache?.stale,ageSeconds:j.cache?.ageSeconds,fetchedAt:j.fetchedAt,sourcesOk:j.sourcesOk,sourcesTotal:j.sourcesTotal});
        save(NEWS,storedNews);
        return {ok:true,meta:{stale:!!j.cache?.stale,ageSeconds:j.cache?.ageSeconds,fetchedAt:j.fetchedAt,sourcesOk:j.sourcesOk,sourcesTotal:j.sourcesTotal}};
      } catch(e) { if(generation===version) return {ok:false,error:errorMessage(e)}; }
    })();
    polling=request;
    try {return await request;} finally {if(polling===request)polling=null;}
  }
  async function prices(symbol, tf, now) {
    const keys=ctx.cfg();
    if (keys.ak || keys.as) {
      if(!keys.ak || !keys.as) throw Error('Both Alpaca keys are required.');
      const start=new Date(now-(tf==='1Day'?365:6)*86400000).toISOString();
      const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),20000);
      let j;
      try { j=await ctx.alp(`/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${tf}&start=${encodeURIComponent(start)}&limit=500&sort=desc&feed=iex&adjustment=raw`,{signal:ctl.signal}); }
      finally { clearTimeout(timer); }
      const bars=cleanBars(j.bars,tf,now);
      if(!bars.length)throw Error('Alpaca returned no completed bars.');
      return {bars,sourceKey:'alpaca-iex',source:'Alpaca / IEX · completed bars only; may include extended hours; IEX is not the consolidated market',asOf:bars.at(-1).t};
    }
    if(tf==='1Min')throw Error('The free feed does not provide one-minute bars; choose 5 minutes, 15 minutes or 1 day, or connect Alpaca.');
    const j=await ctx.edgeGet(`/api/bars?symbol=${encodeURIComponent(symbol)}&tf=${tf}`,25000);
    // Intraday payloads identify the last completed session. Do not trust a
    // current-day free session or a current-day daily candle as completed.
    if(tf!=='1Day' && (!j.sessionDate || j.sessionDate >= etDay(now))) throw Error('The free feed did not provide a verifiable earlier completed session.');
    const bars=cleanBars(j.bars,tf,now,j.sessionDate);
    if(!bars.length)throw Error('The free feed returned no completed bars.');
    return {bars,sourceKey:j.source?`free:${j.source}`:null,source:j.source==='mock'?'Generated demonstration data · not real market prices':`${j.source||'Free feed'} · delayed, not a live quote${cacheLabel(j.cache)}`,asOf:bars.at(-1).t};
  }
  function previousSession(bars, now) {
    const days = new Map();
    for (const b of bars) { const day=etDay(b.t); if(day>=etDay(now))continue; if(!days.has(day))days.set(day,[]); days.get(day).push(b); }
    const keys=[...days.keys()].sort(), last=days.get(keys.at(-1));
    if(!last) return null;
    const previous=days.get(keys.at(-2)), close=last.at(-1).c, prior=previous?.at(-1)?.c;
    const volume=last.reduce((sum,b)=>sum+b.v,0), previousVolumes=keys.slice(-21,-1).map(day=>days.get(day).reduce((sum,b)=>sum+b.v,0));
    const mean=previousVolumes.length?previousVolumes.reduce((a,b)=>a+b,0)/previousVolumes.length:null;
    return {day:keys.at(-1),close,high:Math.max(...last.map(b=>b.h)),low:Math.min(...last.map(b=>b.l)),change:prior>0?(close/prior-1)*100:null,volume,volumeRatio:mean>0?volume/mean:null,volumeSessions:previousVolumes.length};
  }
  function priceSections(p, tf, chosen) {
    const bars=p.bars, last=bars.at(-1), out={};
    if (chosen.includes('patterns')) {
      if (bars.length < 40) out.patterns={error:'At least 40 completed bars are needed for the desk pattern rules.'};
      else {
        const found=ctx.patterns(bars);
        out.patterns={candles:found.candles.slice(0,5).map(x=>({name:x.n,time:bars[x.i1]?.t})),charts:found.charts.slice(0,5).map(x=>({name:x.n,time:bars[x.i1]?.t}))};
      }
    }
    if (chosen.includes('volatility')) {
      try { const a=ctx.structure.analyze(bars.slice(-5000)); out.volatility={regime:a.current.regime,phase:a.current.phase,atrPct:a.current.atrPct,rank:a.current.atrRank}; }
      catch(e){out.volatility={error:String(e.message||e)};}
    }
    if (chosen.includes('volume')) {
      const prev=bars.slice(-21,-1).map(b=>b.v), mean=prev.length===20?prev.reduce((a,b)=>a+b,0)/20:null;
      out.volume={last:last.v,ratio:mean>0?last.v/mean:null};
    }
    return out;
  }
  // Compare only the immediately previous successful briefing. Each item keeps
  // its own evidence so missing sections are never described as unchanged.
  function compareBriefings(previous,current,symbol) {
    const prev=previous && !previous.failed && previous.rows?.find(r=>r.symbol===symbol);
    const next=current?.rows?.find(r=>r.symbol===symbol);
    if(!prev||!next)return {message:'No previous briefing for this stock; changes will appear after the next successful update.',items:[]};
    const items=[], sections=current.settings.sections, before=previous.settings?.sections||[];
    const sameTf=previous.settings?.tf===current.settings.tf;
    const sameSource=!!prev.price?.sourceKey&&prev.price.sourceKey===next.price?.sourceKey;
    const validPrice=sameTf&&sameSource&&Number.isFinite(Date.parse(prev.price?.asOf))&&Number.isFinite(Date.parse(next.price?.asOf))&&Date.parse(next.price.asOf)>=Date.parse(prev.price.asOf);
    const add=(title,detail,target,headline)=>items.push({title,detail,target,headline});
    for(const key of ['patterns','volume']) {
      if(!sections.includes(key))continue;
      const old=prev.sections?.[key], now=next.sections?.[key];
      if(!before.includes(key)||!old||old.error||!now||now.error){add(LABELS[key],'Comparison unavailable: this section was missing or unavailable in one briefing.',key);continue}
      if(!validPrice){add(LABELS[key],'Comparison unavailable: timeframe, data source, or bar timestamps do not match.',key);continue}
      if(key==='volume'){
        if(!Number.isFinite(old.ratio)||!Number.isFinite(now.ratio)){add('Volume','Relative-volume comparison unavailable in one briefing.',key);continue}
        const delta=now.ratio-old.ratio;
        add('Volume',`Last-bar volume compared with its preceding 20 bars: ${fmt(old.ratio)}× → ${fmt(now.ratio)}× (${delta>=0?'+':''}${fmt(delta)}×); bar timestamps ${dateTime(prev.price.asOf)} → ${dateTime(next.price.asOf)}.`,key);
      }else {
        if(!Array.isArray(old.candles)||!Array.isArray(old.charts)||!Array.isArray(now.candles)||!Array.isArray(now.charts)){add('Patterns','Comparison unavailable: pattern details are missing.',key);continue}
        if([...old.candles,...old.charts,...now.candles,...now.charts].some(p=>!p.time||!Number.isFinite(Date.parse(p.time)))){add('Patterns','Comparison incomplete: one or more pattern timestamps are missing or invalid.',key);continue}
        const keyOf=(type,p)=>`${type}|${p.name}|${p.time||''}`;
        const oldKeys=new Set([...old.candles.map(p=>keyOf('candle',p)),...old.charts.map(p=>keyOf('chart',p))]);
        const fresh=[...now.candles.map(p=>({...p,type:'Candlestick'})),...now.charts.map(p=>({...p,type:'Chart'}))].filter(p=>p.name&&p.time&&!oldKeys.has(keyOf(p.type==='Chart'?'chart':'candle',p)));
        if(fresh.length)for(const p of fresh)add('New pattern match',`${p.type}: ${p.name} · pattern bar ${dateTime(p.time)}. Newly appearing in the displayed list; a rule match, not a forecast.`,key);
        else add('Patterns','No new pattern matches in the displayed list; it is limited to five per type.',key);
      }
    }
    if(sections.includes('news')){
      const old=prev.sections?.news,now=next.sections?.news;
      if(!before.includes('news')||!old?.check?.ok||!now?.check?.ok||!Array.isArray(old.items)||!Array.isArray(now.items))add('News','Comparison unavailable: a headline check failed or news was not selected in both briefings.','news');
      else {
        const priorIds=new Set(old.items.map(n=>n.id||n.url||n.title));
        const fresh=now.items.filter(n=>!priorIds.has(n.id||n.url||n.title));
        if(fresh.length)for(const n of fresh)add('New in displayed headlines',`${n.source||'Unknown source'} · published ${dateTime(n.publishedAt)} · ${n.title}. The filtered list and feed coverage are limited${now.check.meta?.stale?'; the latest feed is stale':''}.`,'news',{url:safeUrl(n.url)});
        else add('News',`No new headlines in the displayed filtered list; feed coverage is incomplete${now.check.meta?.stale?' and the latest feed is stale':''}.`,'news');
      }
    }
    if(!items.length) return {message:'No comparable volume, pattern or news sections were selected.',items:[]};
    return {message:`Compared with briefing built ${dateTime(previous.createdAt)}. Differences describe observed data, not predictions.`,items};
  }
  function renderChanges(changes,symbol) {
    if(!changes)return text('No saved comparison is available for this briefing.');
    const allowed=['patterns','volume','news'];
    const rows=(changes.items||[]).map(x=>{
      const target=allowed.includes(x.target)?`assistant-${symbol}-${x.target}`:'assistant-output';
      const url=safeUrl(x.headline?.url);
      const headline=url?` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open headline</a>`:'';
      return `<li><b>${esc(x.title)}:</b> ${esc(x.detail)} <button class="ask" type="button" data-assistant-evidence="${esc(target)}">View evidence</button>${headline}</li>`;
    }).join('');
    return text(changes.message)+(rows?`<ul class="x">${rows}</ul>`:'');
  }
  async function build(reason) {
    if (!settings || busy) return;
    const captured=JSON.parse(JSON.stringify(settings)), generation=version, now=Date.now(); busy=true;
    status('Building briefing for '+captured.symbols.join(', ')+'…');
    let successes=0;
    try {
      let newsResult=null, calendar=null, market=null;
      if(captured.sections.includes('news')) newsResult=await pollNews();
      if(captured.sections.includes('research')) {
        try { const m=await ctx.edgeGet('/api/research/market',25000);
          if(!m.available)throw Error(m.message||'Market research unavailable.');
          if(!m.asOf || m.asOf>=etDay(now))throw Error('Market research includes today’s daily data, which may still be incomplete; check again after the next session date.');
          market={asOf:m.asOf,cache:m.cache,brief:m.brief}; successes++;
        } catch(e){market={error:errorMessage(e)};}
      }
      if(captured.sections.includes('calendar')) {
        try { const c=await ctx.edgeGet('/api/calendar',15000); if(!Array.isArray(c.events))throw Error('Invalid calendar response.'); calendar={events:c.events.filter(e=>e.country==='USD' && Date.parse(e.date)>=now && Date.parse(e.date)<=now+7*86400000).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).slice(0,8),cache:c.cache}; successes++; }
        catch(e){calendar={error:errorMessage(e)};}
      }
      const rows=[];
      const rowsByIndex=new Array(captured.symbols.length);
      let index=0;
      async function work() {
       while(index<captured.symbols.length && generation===version) {
        const i=index++, symbol=captured.symbols[i];
        const row={symbol,sections:{}};
        if(captured.sections.some(s=>['patterns','volatility','volume'].includes(s))) {
          try {const p=await prices(symbol,captured.tf,now); row.price={source:p.source,sourceKey:p.sourceKey,asOf:p.asOf,count:p.bars.length,previous:previousSession(p.bars,now)}; Object.assign(row.sections,priceSections(p,captured.tf,captured.sections)); successes++;}
          catch(e){for(const s of ['patterns','volatility','volume'])if(captured.sections.includes(s))row.sections[s]={error:errorMessage(e)};}
        }
        if(captured.sections.includes('research')) {
          try {const r=await ctx.edgeGet(`/api/research/brief?symbol=${encodeURIComponent(symbol)}`,25000);
            if(!r.available)throw Error(r.message||'Insufficient history.');
            if(!r.asOf || r.asOf>=etDay(now))throw Error('Research includes today’s daily data, which may still be incomplete; check again after the next session date.');
            row.sections.research={asOf:r.asOf,source:r.source,cache:r.cache,headline:r.brief?.headline,blocks:(r.brief?.blocks||[]).map(b=>({title:b.title,text:b.text,evidence:b.evidence})),model:r.model,gaps:r.brief?.dataGaps||[]}; successes++;
          }catch(e){row.sections.research={error:errorMessage(e)};}
        }
        if(captured.sections.includes('news')) {
          const matches=ctx.free.newsForSymbol(storedNews,symbol,6);
          row.sections.news={items:matches,check:newsResult};
        }
        if(captured.sections.includes('calendar')) row.sections.calendar=calendar;
        rowsByIndex[i]=row;
       }
      }
      await Promise.all(Array.from({length:Math.min(2,captured.symbols.length)},()=>work()));
      rows.push(...rowsByIndex.filter(Boolean));
      if(newsResult?.ok)successes++;
      if(generation!==version)return;
      if(!successes){
        nextRetry=Date.now()+15*60000; retryPending=true;
        if(!report || report.failed){report={createdAt:new Date().toISOString(),settings:captured,rows,market,unread:false,failed:true};render();}
        status('The selected data sources are unavailable. Any earlier briefing is kept; retrying in 15 minutes, or refresh manually.');return;
      }
      const next={createdAt:new Date().toISOString(),settings:captured,rows,market,unread:!isOpen() || document.hidden};
      for(const row of rows) row.changes=compareBriefings(report,next,row.symbol);
      report=next; save(REPORT,report);
      if(reason==='scheduled' || due(captured,schedule,new Date())){schedule=localDay(new Date());save(SCHEDULE,schedule);}
      nextRetry=0; retryPending=false; badge(); render(); status('Briefing built '+dateTime(report.createdAt)+'. Sources and limitations are shown below.');
    } finally { busy=false; if(pending){pending=false; build('manual');} }
  }
  function renderSection(key, s, row) {
    if(!s || s.error) return empty(s?.error||'No data returned.');
    if(key==='patterns') {
      const show=items=>items.length?items.map(x=>`${esc(x.name)} (${esc(dateTime(x.time))})`).join(', '):'None detected in this window';
      return text(`Based on ${TF[report.settings.tf]} completed bars; these heuristic matches are not predictions.`)+`<p class="x"><b>Candles:</b> ${show(s.candles)}<br><b>Chart patterns:</b> ${show(s.charts)}</p>`;
    }
    if(key==='volatility') return text(`${s.regime}; ${s.phase}. ATR is ${fmt(s.atrPct)}% of price${Number.isFinite(s.rank)?`; recent ATR percentile ${fmt(s.rank)} / 100`:''}. Descriptive structure rules, not the separately trained volatility model.`);
    if(key==='volume') return text(`Last completed ${TF[report.settings.tf]} bar: ${Number(s.last).toLocaleString()} shares. ${s.ratio==null?'A 20-bar comparison is unavailable.':`Relative to the prior 20 bars: ${fmt(s.ratio)}×.`} Volume reflects the named source, not necessarily the whole market.`);
    if(key==='research') {
      const blocks=(s.blocks||[]).map(b=>`<p class="x"><b>${esc(b.title)}:</b> ${esc(b.text)}${Array.isArray(b.evidence)&&b.evidence.length?` <span class="muted">(${b.evidence.map(e=>esc(e.label)+': '+esc(e.value)).join(' · ')})</span>`:''}</p>`).join('');
      const m=s.model, band=m?.band, cov=m?.backtest?.coverage?.['80'];
      const model=band&&Number.isFinite(band.p10)&&Number.isFinite(band.p90)?text(`Next-session high–low range estimate: ${(band.p10*100).toFixed(2)}%–${(band.p90*100).toFixed(2)}% of price (nominal 80% band). ${Number.isFinite(cov)?`Historical walk-forward coverage: ${Math.round(cov*100)}% over ${m.backtest.sessions} sessions.`:'Historical coverage unavailable.'} Not a direction forecast.`):text('Range model unavailable or insufficient history.');
      return text(`Daily research · as of ${s.asOf||'unknown'} · ${s.source||'source not specified'}${cacheLabel(s.cache)}. This is independent of the selected chart timeframe.`)+text(s.headline||'')+blocks+model+(s.gaps||[]).map(text).join('');
    }
    if(key==='news') {
      const check=s.check, meta=check?.meta;
      const provenance=check?.ok ? `Latest check: ${dateTime(meta.fetchedAt)}; ${meta.sourcesOk}/${meta.sourcesTotal} feeds${cacheLabel(meta)}.` : `Latest check failed or was interrupted: ${check?.error||'unavailable'}.`;
      const items=(s.items||[]).map(n=>{const link=safeUrl(n.url),title=esc(n.title);return `<li>${link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${title}</a>`:title} <span class="muted">· ${esc(n.source)} · ${esc(dateTime(n.publishedAt))}${n.cache?.stale?' · observed from stale feed':''}</span></li>`}).join('');
      return text(provenance+' Filtered by ticker or company name from aggregated market headlines; not comprehensive. Includes saved headlines observed since yesterday when available. Browser sleep and feed limits can cause gaps.')+(items?`<ul class="x">${items}</ul>`:text('No matching headlines found; this does not mean no news occurred.'));
    }
    if(key==='calendar') {
      const items=(s.events||[]).map(e=>`<li>${esc(dateTime(e.date))} · ${esc(e.title)} · ${esc(e.impact||'not rated')}</li>`).join('');
      return text(`Upcoming US economic events, next 7 days; market-wide, not specific to this stock${cacheLabel(s.cache)}. Schedules can change.`)+(items?`<ul class="x">${items}</ul>`:text('No upcoming US events returned; the calendar may be incomplete.'));
    }
    return '';
  }
  function render() {
    const out=$('assistant-output'); if(!out || !report || !Array.isArray(report.rows))return;
    const selected=report.settings.sections, order=[report.settings.priority,...selected.filter(x=>x!==report.settings.priority)];
    const market=report.settings.sections.includes('research') ? `<div class="panel"><h2>Market-wide research</h2><div class="pbody">${!report.market||report.market.error?empty(report.market?.error||'No market brief returned.'):text(`Daily market brief · as of ${report.market.asOf||'unknown'}${cacheLabel(report.market.cache)}.`)+text(report.market.brief?.headline||'')+(report.market.brief?.blocks||[]).map(b=>text(`${b.title}: ${b.text}`)).join('')}</div></div>` : '';
    out.innerHTML=`<div class="panel"><div class="pbody"><p class="x">${report.failed?'Attempted':'Built'} ${esc(dateTime(report.createdAt))} · ${esc(TF[report.settings.tf])} chart timeframe · ${report.failed?'No briefing could be built from the selected sources.':'Snapshots may become stale.'} Refresh to check again. Nothing here is a recommendation.</p></div></div>`+market+report.rows.map(row=>`<div class="panel"><h2>${esc(row.symbol)}</h2><div class="pbody">${row.price?text(`${row.price.source} · last bar ${dateTime(row.price.asOf)} · ${row.price.count} completed bars`):''}${row.price?.previous?text(`Previous available session ${row.price.previous.day}: last close $${fmt(row.price.previous.close)}, high $${fmt(row.price.previous.high)}, low $${fmt(row.price.previous.low)}${row.price.previous.change==null?'':`; change from prior available close ${fmt(row.price.previous.change)}%`}. ${selected.includes('volume')?`Available-bar volume ${Number(row.price.previous.volume).toLocaleString()} shares${row.price.previous.volumeRatio==null?'':`, ${fmt(row.price.previous.volumeRatio)}× the mean of ${row.price.previous.volumeSessions} prior available sessions`}. `:''}This is the available bar window, not necessarily the official regular-session close; intraday coverage may be incomplete or include extended hours.`):''}${section('What changed',renderChanges(row.changes,row.symbol))}${order.map(k=>section(LABELS[k],renderSection(k,row.sections[k],row),`assistant-${row.symbol}-${k}`)).join('')}</div></div>`).join('');
  }
  async function tick() {
    if(!settings)return;
    if((retryPending || due(settings,schedule,new Date())) && !busy && Date.now()>=nextRetry) { await build('scheduled'); return; }
    if(settings.sections.includes('news') && !busy && !polling && Date.now()-lastPoll>=settings.interval*60000) await pollNews();
  }
  function init(options) {
    ctx=options;
    try{settings=normalize(read(CFG,null));}catch(_){settings=null;}
    report=read(REPORT,null); storedNews=mergeNews(read(NEWS,[]),[],Date.now(),null); schedule=read(SCHEDULE,'');
    if(report) { try { report.settings=normalize(report.settings); if(!report.settings || !Array.isArray(report.rows) || report.rows.some(r=>!r || !r.sections)) report=null; } catch(_) {report=null;} }
    form(); badge(); render();
    if(report)status('Saved briefing from '+dateTime(report.createdAt)+'. Refresh to check again.');
    $('assistant-output').addEventListener('click',e=>{const button=e.target.closest('[data-assistant-evidence]');if(button)$(button.dataset.assistantEvidence)?.scrollIntoView({block:'start'});});
    $('assistant-watchlist').onclick=()=>{$('assistant-symbols').value=(ctx.watchlist()||[]).slice(0,MAX_SYMBOLS).join(', ')};
    $('assistant-form').onsubmit=e=>{e.preventDefault();
      try { const s=normalize({symbols:$('assistant-symbols').value,tf:$('assistant-tf').value,time:$('assistant-time').value,interval:$('assistant-interval').value,priority:$('assistant-priority').value,sections:[...document.querySelectorAll('#assistant-sections input:checked')].map(el=>el.value)});
        version++; settings=s; save(CFG,s); lastPoll=0; nextRetry=0; retryPending=false; status('Preferences saved locally.');
        if(busy){pending=true;status('Preferences saved; the new briefing will start after the current check finishes.');}
        else build('manual');
      } catch(err) {status(err.message||String(err));}
    };
    $('assistant-refresh').onclick=()=>{if(!settings){status('Save your preferences first.');return;} if(busy){status('A briefing is already being built.');return;} nextRetry=0;build('manual');};
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
    globalThis.addEventListener('online',tick); setInterval(tick,60000); tick();
  }
  return {init,open,normalize,due,mergeNews,cleanBars,compareBriefings};
});
