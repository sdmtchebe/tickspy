const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname,'../..'), build = path.join(root,'frontend/build');
const walk = (dir) => fs.readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
const files = walk(build);
assert(files.every((file)=>!/(?:local-config\.js|\.env(?:\.|$)|\.map$|\.DS_Store$|\.pem$|\.key$)/.test(file)),'Private files or source maps present');
const privateFiles = [path.join(root,'desk/local-config.js'),path.join(root,'frontend/.env'),path.join(root,'worker/.env'),path.join(root,'backend/.env')];
const secrets = new Set();
for (const file of privateFiles.filter(fs.existsSync)) {
  const source = fs.readFileSync(file,'utf8');
  for (const m of source.matchAll(/\b(?:ak|as|[\w]*SECRET[\w]*|[\w]*TOKEN[\w]*|[\w]*API_KEY[\w]*|[\w]*KEY_ID[\w]*)\s*[:=]\s*["']([^"'\r\n]{12,})["']/gi)) {
    if(!/^https?:/.test(m[1]))secrets.add(m[1]);
  }
}
for(const file of files) {
  const content=fs.readFileSync(file);
  for(const secret of secrets) assert(!content.includes(Buffer.from(secret)),`Private credential found in ${path.relative(build,file)}`);
  if(/\.(?:html|js|json|txt)$/.test(file)) assert(!/AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(content.toString()),`Secret-looking token found in ${file}`);
}
console.log(`PASS release contains ${files.length} public assets; no private files, source maps, or matches for ${secrets.size} locally configured credential values.`);
let links=0;
for(const file of files.filter(file=>file.endsWith('.html'))) {
  const html=fs.readFileSync(file,'utf8').replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
  for(const m of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const href=m[1];if(/^(?:[a-z]+:|#|\/\/)/i.test(href))continue;
    const clean=href.split(/[?#]/)[0];if(!clean)continue;
    let target=path.resolve(clean.startsWith('/')?build:path.dirname(file),clean.startsWith('/')?'.'+clean:clean);
    if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
    assert(fs.existsSync(target),`Broken local link in ${path.relative(build,file)}: ${href}`);links++;
  }
}
console.log(`PASS ${links} static local asset and page links resolve.`);

const source = fs.readFileSync(path.join(root,'frontend/src/lib/privacy.js'),'utf8').replace(/^import .*;\n/,'').replace(/export const /g,'const ')+'\nthis.api={getAdsConsent,setAdsConsent,loadAdsense,resetAdsConsent};';
function consentFixture(enabled=true,blocked=false) {
  const store=new Map();let loaded=0,reloaded=0,script=null;
  const sandbox={ADS_ENABLED:enabled,ADSENSE_CLIENT:'test-publisher',window:{localStorage:{getItem:k=>{if(blocked)throw Error();return store.get(k)},setItem:(k,v)=>{if(blocked)throw Error();store.set(k,v)},removeItem:k=>store.delete(k)},location:{reload:()=>{reloaded++}}},document:{querySelector:()=>script,createElement:()=>({dataset:{}}),head:{appendChild:el=>{loaded++;script=el}}}};
  vm.runInNewContext(source,sandbox);
  return {api:sandbox.api,loads:()=>loaded,reloads:()=>reloaded};
}
let f=consentFixture(); f.api.loadAdsense();assert.equal(f.loads(),0); f.api.setAdsConsent('rejected');assert.equal(f.loads(),0);console.log('PASS unknown and rejected consent never load AdSense.');
f=consentFixture(); f.api.setAdsConsent('accepted');assert.equal(f.loads(),1); f.api.loadAdsense();assert.equal(f.loads(),1);f.api.setAdsConsent('rejected');assert.equal(f.reloads(),1);console.log('PASS acceptance loads once; withdrawal stops the running runtime with reload.');
f=consentFixture(false);f.api.setAdsConsent('accepted');assert.equal(f.loads(),0);console.log('PASS deployment-disabled ads cannot load even with previously accepted consent.');
f=consentFixture(true,true);f.api.setAdsConsent('rejected');assert.equal(f.api.getAdsConsent(),'rejected');assert.equal(f.loads(),0);console.log('PASS consent is honoured in memory when browser storage is disabled.');
