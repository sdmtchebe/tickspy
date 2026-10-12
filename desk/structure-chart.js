/* Interactive structure chart. View navigation never changes the engine input. */
(function(){
 'use strict';
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>n.toFixed(n<1?4:2),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const colors={'Bullish trend':'#00E5A0','Bearish trend':'#FF4D6A','Compression':'#82A9FF','Volatile chop':'#FFB347','Mixed / range':'#8A93A6','Warming up':'#868fa0'};
 let state={key:'',count:100,end:0,scale:1,shift:0,length:0};
 function mount(host,bars,result,key){
   if(!host)return;
   if(state.key!==key){state={key,count:100,end:bars.length,scale:1,shift:0,length:bars.length}}
   else {if(state.end===state.length)state.end=bars.length;state.end=Math.min(state.end,bars.length);state.length=bars.length}
   host.innerHTML=`<h3>Explore the price chart</h3><p class="x">Wheel to zoom time. Drag to move through history or move the price view up/down. Hover or touch a candle for its prices. All four engines still describe the latest completed bar, even when you pan into older history.</p>
   <div class="row ms-chart-controls"><button class="btn" data-chart="reset">Latest</button><details><summary>Chart controls</summary><p class="x"><b>Zoom:</b> scroll over candles to show fewer or more bars. Scroll over the price numbers on the right to stretch or compress the price scale.<br><b>Move:</b> drag left/right through time or up/down to reposition prices. On a touchscreen, drag with one finger.<br><b>Inspect:</b> point at or touch a candle to see its exact prices below.<br><b>Reset:</b> Latest (or double-click) restores the latest bars and automatic price scale.<br><b>Keyboard:</b> focus the chart; arrows inspect candles, +/− zoom time, Shift +/− changes the price scale, Shift + arrows pans, Home resets.</p></details></div>
   <p class="x">Blue lines: spread of recent closing prices (Bollinger bands). Shaded zones: clusters of earlier turning points. Gold dashed line: volume-weighted average across up to 120 bars.</p>
   <svg id="ms-chart-svg" viewBox="0 0 800 330" role="img" tabindex="0" aria-label="Interactive price chart. Left and right arrows inspect candles; plus and minus zoom; Home resets." aria-describedby="ms-chart-readout"><defs><clipPath id="ms-plot-clip"><rect x="12" y="12" width="686" height="278"/></clipPath></defs><g id="ms-chart-base"></g><g id="ms-crosshair" pointer-events="none"></g></svg>
   <p id="ms-chart-readout" class="num ms-readout">Hover or touch a candle to inspect its time, opening price, high, low, close and volume.</p><p id="ms-chart-range" class="x"></p><h3>Market behavior over this visible window</h3><div class="ms-ribbon" id="ms-chart-ribbon"></div><div class="ms-legend">${Object.entries(colors).map(([k,c])=>`<span style="color:${c}">■ ${k}</span>`).join('')}</div>`;
   const svg=host.querySelector('svg'),base=host.querySelector('#ms-chart-base'),cross=host.querySelector('#ms-crosshair'),readout=host.querySelector('#ms-chart-readout');
   let map,selected=bars.length-1,drag=null;
   const line=(x1,y1,x2,y2,c,d='')=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-dasharray="${d}"/>`;
   function draw(){
     state.count=clamp(Math.round(state.count),20,bars.length);state.end=clamp(Math.round(state.end),state.count,bars.length);
     const start=state.end-state.count,slice=bars.slice(start,state.end),series=result.series.slice(start,state.end);
     const prices=slice.flatMap(b=>[b.h,b.l]).concat(series.flatMap(v=>[v.upper,v.lower]));
     const low=Math.min(...prices),high=Math.max(...prices),natural=Math.max(high-low,low*.001)*1.16;
     const center=(high+low)/2+state.shift,span=natural/state.scale,lo=center-span/2,hi=center+span/2;
     const dx=686/slice.length,x=i=>12+(i+.5)*dx,y=p=>290-(p-lo)/span*278;
     map={start,end:state.end,x,y,dx,lo,hi,span,natural};let s='';
     for(let i=0;i<=4;i++){const p=lo+span*i/4;s+=line(12,y(p),698,y(p),'#222a36')+`<text x="706" y="${y(p)+4}">${fmt(p)}</text>`}
     let plot='';for(const z of result.levels.zones){const c=z.side==='Support candidate'?'#00E5A0':z.side==='Inside zone'?'#FFB347':'#FF4D6A';plot+=`<rect x="12" y="${y(z.high)}" width="686" height="${Math.max(1,y(z.low)-y(z.high))}" fill="${c}" opacity=".13"/>`+line(12,y(z.price),698,y(z.price),c,'3 5')}
     for(const k of ['upper','lower'])plot+=`<polyline fill="none" stroke="#82A9FF" opacity=".65" points="${series.map((v,i)=>`${x(i)},${y(v[k])}`).join(' ')}"/>`;
     slice.forEach((b,i)=>{const c=b.c>=b.o?'#00E5A0':'#FF4D6A';plot+=line(x(i),y(b.h),x(i),y(b.l),c)+`<rect x="${x(i)-dx*.3}" y="${Math.min(y(b.o),y(b.c))}" width="${dx*.6}" height="${Math.max(1,Math.abs(y(b.o)-y(b.c)))}" fill="${c}"/>`});
     if(result.levels.vwap!=null)plot+=line(12,y(result.levels.vwap),698,y(result.levels.vwap),'#FFB347','6 4');
     s+=`<g clip-path="url(#ms-plot-clip)">${plot}</g><text x="12" y="312">${esc(bars[start].t.slice(0,16))} UTC</text><text x="480" y="312">${esc(bars[state.end-1].t.slice(0,16))} UTC</text>`;
     base.innerHTML=s;cross.innerHTML='';
     host.querySelector('#ms-chart-range').textContent=`Viewing bars ${start+1}–${state.end} of ${bars.length}. Price scale ${state.scale.toFixed(1)}×. Keyboard: ←/→ inspect, +/− zoom, Home reset.`;
     host.querySelector('#ms-chart-ribbon').innerHTML=series.map(v=>`<span style="background:${colors[v.regime]}" title="${esc(bars[v.i].t)}: ${v.regime}"></span>`).join('');
     svg.dataset.start=start;svg.dataset.end=state.end;svg.dataset.count=state.count;svg.dataset.scale=state.scale;
   }
   function inspect(index,price){
     selected=clamp(index,map.start,map.end-1);const b=bars[selected],px=map.x(selected-map.start),py=clamp(map.y(price==null?b.c:price),12,290),value=price==null?b.c:price;
     cross.innerHTML=line(px,12,px,290,'#E8ECF4','3 3')+line(12,py,698,py,'#E8ECF4','3 3')+`<rect x="700" y="${py-10}" width="98" height="20" fill="#0e1324"/><text x="705" y="${py+4}">${fmt(value)}</text>`;
     readout.textContent=`${b.t} · Open ${fmt(b.o)} · High ${fmt(b.h)} · Low ${fmt(b.l)} · Close ${fmt(b.c)} · Volume ${b.v.toLocaleString('en-US')} · Cursor price ${fmt(value)}`;
   }
   function pos(e){const r=svg.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*800,y:(e.clientY-r.top)/r.height*330}}
   function zoom(factor,fraction=.5){const old=state.count,next=clamp(Math.round(old*factor),20,bars.length),anchor=state.end-old+old*fraction;state.count=next;state.end=anchor+next*(1-fraction);draw()}
   function action(name){
     if(name==='in')zoom(.8);else if(name==='out')zoom(1.25);
     else {if(name==='left')state.end-=Math.max(1,Math.round(state.count*.2));if(name==='right')state.end+=Math.max(1,Math.round(state.count*.2));if(name==='tall')state.scale=clamp(state.scale*1.25,.25,8);if(name==='short')state.scale=clamp(state.scale/1.25,.25,8);if(name==='up')state.shift+=map.span*.15;if(name==='down')state.shift-=map.span*.15;if(name==='reset'){state.count=Math.min(100,bars.length);state.end=bars.length;state.scale=1;state.shift=0}draw()}
   }
   host.querySelectorAll('[data-chart]').forEach(b=>b.onclick=()=>action(b.dataset.chart));
   svg.addEventListener('wheel',e=>{e.preventDefault();const p=pos(e);if(p.x>698){state.scale=clamp(state.scale*Math.exp(-e.deltaY*.002),.25,8);draw()}else zoom(Math.exp(e.deltaY*.002),clamp((p.x-12)/686,0,1))},{passive:false});
   svg.onpointerdown=e=>{if(e.button!==0)return;const p=pos(e);drag={id:e.pointerId,x:p.x,y:p.y,end:state.end,shift:state.shift,span:map.span,count:state.count};svg.setPointerCapture(e.pointerId);svg.focus({preventScroll:true});inspect(map.start+Math.floor((p.x-12)/map.dx),map.hi-(p.y-12)/278*map.span)};
   svg.onpointermove=e=>{const p=pos(e);if(drag&&drag.id===e.pointerId){state.end=drag.end-(p.x-drag.x)/686*drag.count;state.shift=drag.shift+(p.y-drag.y)/278*drag.span;draw()}inspect(map.start+Math.floor((clamp(p.x,12,698)-12)/map.dx),map.hi-(clamp(p.y,12,290)-12)/278*map.span)};
   const release=()=>{drag=null};svg.onpointerup=release;svg.onpointercancel=release;svg.onlostpointercapture=release;
   svg.onpointerleave=()=>{if(!drag)cross.innerHTML=''};
   svg.ondblclick=()=>action('reset');
   svg.onkeydown=e=>{if(['ArrowLeft','ArrowRight','+','=','-','_','Home'].includes(e.key)){e.preventDefault();if(e.shiftKey&&e.key!=='Home'){action(e.key==='ArrowLeft'?'left':e.key==='ArrowRight'?'right':e.key==='-'||e.key==='_'?'short':'tall')}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){selected=clamp(selected+(e.key==='ArrowLeft'?-1:1),0,bars.length-1);if(selected<map.start)state.end=selected+state.count;if(selected>=map.end)state.end=selected+1;draw();inspect(selected)}else action(e.key==='Home'?'reset':e.key==='-'?'out':'in')}};
   draw();
 }
 window.StructureChart={mount};
})();
