/* Estimated OHLCV profile: no tick-by-tick volume claims. */
(function(){
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const fmt=x=>x.toFixed(Math.abs(x)<1?4:2);
 let key='',view={zoom:1,shift:0,index:null},data=[],last=null,drag=null;
 function mount(){const cv=document.getElementById('vp');if(cv.dataset.interactive)return cv;
  cv.dataset.interactive='true';cv.tabIndex=0;cv.style.touchAction='none';cv.style.cursor='crosshair';
  cv.setAttribute('aria-label','Estimated volume profile. Hover or touch for price and volume. Arrow keys inspect buckets; plus and minus zoom; Home resets.');
  cv.insertAdjacentHTML('afterend','<p id="vp-readout" class="x num" aria-live="polite">Point at or touch a price row to inspect its estimated volume.</p><div class="row"><button class="btn" id="vp-reset" type="button">Reset view</button><details><summary>Profile controls</summary><p class="x">Point at a row to see its price range, assigned volume and share of the total. Scroll to zoom the price scale; drag vertically to move it. Touch works too. Keyboard: ↑/↓ selects a row, +/− zooms, Home resets. Width represents estimated volume, not elapsed time.</p></details></div>');
  const reset=()=>{view={zoom:1,shift:0,index:null};paint()};document.getElementById('vp-reset').onclick=reset;cv.ondblclick=reset;
  function point(e){const r=cv.getBoundingClientRect();return (e.clientY-r.top)/r.height*cv.clientHeight}
  function inspect(y){if(!last)return;const p=last.hi-(clamp(y,24,last.height-12)-24)/last.ph*last.span;view.index=clamp(Math.floor((p-last.base)/last.step),0,35);paint()}
  cv.onpointermove=e=>{if(drag){view.shift=drag.shift+(point(e)-drag.y)/last.ph*drag.span;paint()}inspect(point(e))};
  cv.onpointerdown=e=>{if(!last)return;drag={y:point(e),shift:view.shift,span:last.span};cv.setPointerCapture(e.pointerId);cv.focus({preventScroll:true});inspect(point(e))};
  cv.onpointerup=cv.onpointercancel=cv.onlostpointercapture=()=>{drag=null};
  cv.addEventListener('wheel',e=>{if(!last)return;e.preventDefault();view.zoom=clamp(view.zoom*Math.exp(-e.deltaY*.002),1,10);paint()},{passive:false});
  cv.onkeydown=e=>{if(!['ArrowUp','ArrowDown','+','=','-','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home')return reset();if(e.key==='ArrowUp'||e.key==='ArrowDown'){view.index=clamp((view.index??18)+(e.key==='ArrowUp'?1:-1),0,35);view.shift=0;view.zoom=1}else view.zoom=clamp(view.zoom*(e.key==='-'?.8:1.25),1,10);paint()};return cv;
 }
 function paint(){const cv=mount(),ctx=cv.getContext('2d'),w=cv.clientWidth,h=cv.clientHeight,d=window.devicePixelRatio||1;if(!w)return;
  cv.width=w*d;cv.height=h*d;ctx.scale(d,d);last=null;
  if(!data.length){document.getElementById('vp-readout').textContent='No bars available for this selection.';return}
  const lo=Math.min(...data.map(b=>b.l)),high=Math.max(...data.map(b=>b.h)),step=(high-lo)/36||Math.max(lo*.0001,.0001),base=high===lo?lo-step*18:lo;
  const bins=Array(36).fill(0);data.forEach(b=>bins[clamp(Math.floor(((b.h+b.l+b.c)/3-base)/step),0,35)]+=b.v);
  const total=bins.reduce((a,b)=>a+b,0),max=Math.max(...bins)||1,poc=bins.indexOf(Math.max(...bins));let a=poc,b=poc,acc=bins[poc];
  while(acc<total*.7&&(a>0||b<35)){if((b<35?bins[b+1]:-1)>=(a>0?bins[a-1]:-1)){b++;acc+=bins[b]}else{a--;acc+=bins[a]}}
  const span=step*36/view.zoom,hi=base+step*18+view.shift+span/2,ph=h-36,plot=Math.max(30,w-110),y=p=>24+(hi-p)/span*ph;
  last={hi,span,ph,height:h,base,step};cv.dataset.zoom=view.zoom;
  ctx.font='11px monospace';ctx.textBaseline='middle';ctx.fillStyle='#aeb7c6';ctx.fillText(`${data.length} candles · estimated volume`,2,10);
  ctx.save();ctx.beginPath();ctx.rect(0,24,w,ph);ctx.clip();
  bins.forEach((v,i)=>{const top=y(base+(i+1)*step),height=step/span*ph-1;ctx.fillStyle=i===poc?'#D9A441':i>=a&&i<=b?'#8698af':'#4e5d72';ctx.fillRect(0,top,v/max*plot,Math.max(1,height))});
  for(let j=0;j<=4;j++){const p=hi-span*j/4,py=y(p);ctx.fillStyle='#aeb7c6';ctx.fillText(fmt(p),plot+8,clamp(py,30,h-18))}
  if(view.index!=null){const i=view.index,p=base+(i+.5)*step,py=y(p);ctx.strokeStyle='#eef1f6';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(w,py);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#212734';ctx.fillRect(plot+3,py-10,w-plot,20);ctx.fillStyle='#eef1f6';ctx.fillText(fmt(p),plot+8,py);
   document.getElementById('vp-readout').textContent=`Price ${fmt(base+i*step)}–${fmt(base+(i+1)*step)} · Estimated volume ${Math.round(bins[i]).toLocaleString()} shares · ${total?(bins[i]/total*100).toFixed(1):'0.0'}% of total${i===poc?' · POC (largest bucket)':''}${i>=a&&i<=b?' · Inside estimated value area':''}`;
  }else document.getElementById('vp-readout').textContent=`POC ${fmt(base+(poc+.5)*step)} · Total ${Math.round(total).toLocaleString()} shares. Hover or touch a row for its price and estimated volume.`;
  ctx.restore();
 }
 window.DeskProfile={render(bars,selection){if(selection!==key){key=selection;view={zoom:1,shift:0,index:null}}data=bars.slice(-90);paint()}};
})();
