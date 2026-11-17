window.__pg=window.__pg||((url,ms=20000)=>new Promise(res=>{const id='s'+Math.random();const h=e=>{if(e.data&&e.data.apeiraRes&&e.data.apeiraRes.id===id){window.removeEventListener('message',h);res(e.data.apeiraRes)}};window.addEventListener('message',h);window.postMessage({apeiraReq:{id,url}},'*');setTimeout(()=>{window.removeEventListener('message',h);res({s:0,t:''})},ms)}));
async function mineSM(){
 if(window.__smRun)return 'running';window.__smRun=1;
 let P;try{P=JSON.parse(localStorage.getItem('apeira_sm')||'{}')}catch(e){P={}}
 P.done=P.done||[];P.stats=P.stats||{dom:0,pages:0,cands:0};
 const save=()=>{try{localStorage.setItem('apeira_sm',JSON.stringify(P))}catch(e){}};
 const H=JSON.parse(localStorage.getItem('apeira_hubs')||'[]');
 const SKIP=/(linkedin|twitter|x\.com|facebook|instagram|youtube|youtu\.be|google|apple\.com|microsoft|github|medium\.com|wordpress|wix|squarespace|vimeo|tiktok|eventbrite|calendly|hubspot|mailchimp|typeform|cookiebot|gstatic|cloudflare|amazonaws|w3\.org|schema\.org|creativecommons|europa\.eu|bit\.ly|t\.me|whatsapp|spotify|flickr|issuu|slideshare|xing\.com|crunchbase|dealroom|f6s|angel\.co|wellfound|pitchbook|tracxn|glassdoor|indeed|wikipedia|pinterest|substack|goo\.gl|doi\.org|saashub|producthunt|elementor|wpengine|onetrust|usercentrics|matomo|jquery|fontawesome|gravatar)/i;
 const PAT=/(startup|start-up|portfolio|compan|spin|venture|alumni|member|cohort|resident|participant|founder|listing|directory|team|project|incubat|accelerat|programme|program|batch|winner|finalist|unternehmen|entreprise|impres)/i;
 const DIR=/^(startups?|start-ups?|portfolio|companies|company|spin-?offs?|spin-?outs?|spinouts?|alumni|ventures|teams|members|participants|cohorts?|projects?|listings?|directory|unternehmen|entreprises|imprese|residents|founders|incubatees|winners|finalists|projekte|empresas|bedrijven|foretag|yritykset)$/i;const VCN=/(redalpine|portugal ?ventures|ewor|htgf|gr[uü]nderfonds|quantonation|localglobe|seedcamp|partech|eurazeo|elaia|^na[: ]|pool-na|\.edu$|\.nyc$|usa|silicon valley|capital|partners|fund|vc|ventures?$|antler|seedcamp|entrepreneur first|joinef|investor)/i;const doms=[];const seen=new Set();
 for(const h of H){let u;try{u=new URL(h.url)}catch(e){continue}const d=u.hostname.replace(/^www\./,'');if(seen.has(d)||P.done.includes(d))continue;if(/(linkedin|google|youtube|medium|twitter|facebook|saashub|producthunt|github|eu-startups|thehub\.io|startbase)/.test(d))continue;if(VCN.test(h.name)||VCN.test(d))continue;seen.add(d);doms.push({d,o:u.origin,n:h.name})}
 doms.sort((a,b)=>(PAT.test(b.n)?1:0)-(PAT.test(a.n)?1:0));
 P.todo=doms.length;save();
 const LOC=t=>[...t.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]\s]+)/gi)].map(m=>m[1].trim());
 for(const D of doms){
  window.__smtick=Date.now();
  try{
   let locs=[],sub=[];
   for(const t of [D.o+'/sitemap_index.xml',D.o+'/sitemap.xml',D.o+'/wp-sitemap.xml']){const r=await __pg(t);if(r.s===200&&/<loc>/i.test(r.t)){if(/<sitemapindex/i.test(r.t))sub=LOC(r.t);else locs=LOC(r.t);break}}
   if(sub.length){const good=sub.filter(s=>PAT.test(s.replace(D.o,''))&&!/(post-sitemap|news|blog|event|attachment|category|tag|author|page-sitemap)/i.test(s)).slice(0,6);for(const s of good){const r=await __pg(s);if(r.s===200)locs.push(...LOC(r.t))}}
   let pages=locs.filter(l=>{try{const p=new URL(l).pathname.split('/').filter(Boolean);return p.length>=2&&DIR.test(p[p.length-2])&&!/\.(jpg|jpeg|png|pdf|webp|svg)$/i.test(l)}catch(e){return false}});
   pages=[...new Set(pages)].slice(0,400);
   if(pages.length<5){P.done.push(D.d);save();continue}
   P.stats.dom++;
   const per=[],cnt={};
   for(let i=0;i<pages.length;i+=6){
     window.__smtick=Date.now();
     const rs=await Promise.all(pages.slice(i,i+6).map(async pu=>{const r=await __pg(pu);if(r.s!==200||!r.t)return null;const doc=new DOMParser().parseFromString(r.t,'text/html');doc.querySelectorAll('header,footer,nav,script,style').forEach(e=>e.remove());const ex={};for(const a of doc.querySelectorAll('a[href]')){let x;try{x=new URL(a.getAttribute('href'),pu)}catch(e){continue}if(!/^https?:$/.test(x.protocol))continue;const h=x.hostname.replace(/^www\./,'').toLowerCase();if(!h||h.endsWith(D.d)||D.d.endsWith(h)||SKIP.test(h))continue;const lab=((a.innerText||'')+' '+(a.getAttribute('title')||'')).toLowerCase();ex[h]=Math.max(ex[h]||0,/(website|visit|site web|webseite|sito|homepage|www|\.com|\.io|\.ai)/.test(lab)?2:1)}const title=((doc.querySelector('h1')||{}).innerText||'').trim().slice(0,80);const txt=(doc.body?doc.body.innerText:'').replace(/\s+/g,' ');const y=(txt.match(/(?:founded|gegr.ndet|fond.e?|fondata|established|founding year|year of foundation)[^0-9]{0,25}(20[012]\d)/i)||[])[1];return{ex,title,y:y?+y:null}}));
     for(const x of rs){if(!x)continue;P.stats.pages++;per.push(x);for(const h in x.ex)cnt[h]=(cnt[h]||0)+1}
   }
   const thr=Math.max(3,per.length*0.15);const list=[];
   for(const x of per){const hs=Object.keys(x.ex).filter(h=>cnt[h]<thr);if(!hs.length)continue;let pick=hs.filter(h=>x.ex[h]===2);if(!pick.length)pick=hs.length<=2?hs:[];for(const h of pick.slice(0,1))list.push({u:'https://'+h,n:x.title||h,h:'SM: '+D.n,y:x.y||undefined})}
   if(list.length)W.postMessage({cmd:'addcands',list});
   P.stats.cands+=list.length;P.done.push(D.d);P.last=D.d+' '+pages.length+'p '+list.length+'c';(P.top=P.top||[]).push([D.d,list.length]);save();
  }catch(e){P.done.push(D.d);save()}
 }
 window.__smRun=0;P.finished=1;save();return 'done';
}
