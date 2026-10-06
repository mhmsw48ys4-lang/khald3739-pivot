const FINNHUB_BASE = "https://finnhub.io/api/v1";

const HTML = String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>📰 ماسح الأخبار | أسهم $1–$7</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#07111f;color:#eef4ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,Arial,sans-serif}
.wrap{max-width:1050px;margin:auto;padding:22px}.head{background:#0d1b2d;border:1px solid #1e3550;border-radius:18px;padding:20px;margin-bottom:16px}
h1{margin:0 0 8px;font-size:27px}.sub{color:#9eb1c9}.bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
button{border:0;border-radius:12px;padding:12px 18px;background:#1769e0;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
button:disabled{opacity:.6}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.stat{background:#0d1b2d;border:1px solid #1e3550;border-radius:14px;padding:14px;text-align:center}.num{font-size:22px;font-weight:800;display:block;margin-top:4px}
#status{color:#9eb1c9;margin:12px 0}.card{background:#0d1b2d;border:1px solid #1e3550;border-radius:16px;padding:16px;margin:11px 0}.top{display:flex;justify-content:space-between;gap:10px;align-items:center}.ticker{font-size:20px;font-weight:900}.meta{color:#9eb1c9;font-size:13px}.title{font-size:18px;font-weight:800;margin:10px 0;line-height:1.5}.summary{color:#c3cfde;line-height:1.7}.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:#172941;margin-left:6px;font-size:12px}.pos{background:#103b2a;color:#6ee7a5}.neg{background:#4a1e27;color:#ff9eac}.hot{background:#513b12;color:#ffd978}.link{display:inline-block;margin-top:10px;color:#78b4ff;text-decoration:none}.empty{padding:30px;text-align:center;color:#9eb1c9}
@media(max-width:650px){.stats{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
</style></head>
<body><main class="wrap">
<section class="head">
<h1>📰 ماسح الأخبار</h1>
<div class="sub">أخبار الأسهم الأمريكية من $1 إلى $7 — الأحدث أولًا</div>
<div class="bar"><button id="refresh">🔄 تحديث الأخبار</button></div>
</section>
<section class="stats">
<div class="stat">مطابقة السعر<span id="count" class="num">—</span></div>
<div class="stat">آخر ساعة<span id="hour" class="num">—</span></div>
<div class="stat">أخبار ساخنة<span id="hot" class="num">—</span></div>
</section>
<div id="status">جارٍ التحميل...</div><section id="list"></section>
</main>
<script>
const $=id=>document.getElementById(id);
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function age(ts){const m=Math.max(0,Math.floor((Date.now()-ts)/60000));if(m<1)return"الآن";if(m<60)return m+" د";const h=Math.floor(m/60);if(h<24)return h+" س";return Math.floor(h/24)+" يوم"}
function tone(text){const s=(text||"").toLowerCase();const pos=["approval","approved","fda","contract","agreement","acquisition","acquire","merger","partnership","deal","guidance raised","raises","award","trial success","positive","launch","order"].some(x=>s.includes(x));const neg=["offering","dilution","dilutive","reverse split","bankruptcy","default","layoff","delisting","sec investigation","fraud","lawsuit","guidance cut","negative"].some(x=>s.includes(x));return pos&&!neg?["إيجابي","pos"]:neg&&!pos?["سلبي","neg"]:["محايد",""]}
async function load(){ $("refresh").disabled=true;$("status").textContent="جارٍ جلب أحدث الأخبار...";$("list").innerHTML="";
try{const r=await fetch("/api/news?ts="+Date.now(),{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"فشل الطلب");
$("count").textContent=d.stats?.matching??d.items?.length??0;$("hour").textContent=d.stats?.lastHour??0;$("hot").textContent=d.stats?.hot??0;
if(!d.items?.length){$("list").innerHTML='<div class="empty">لا توجد أخبار مطابقة حاليًا في مصدر الأخبار.</div>'}
else{$("list").innerHTML=d.items.map(x=>{const t=tone(x.headline+" "+x.summary);return '<article class="card"><div class="top"><div><span class="ticker">$'+esc(x.symbol)+'</span><span class="pill">'+esc(x.source||"مصدر")+'</span><span class="pill">'+esc(age(x.datetime*1000))+'</span></div><div><span class="pill '+t[1]+'">'+t[0]+'</span>'+(x.hot?'<span class="pill hot">🔥 ساخن</span>':"")+'</div></div><div class="title">'+esc(x.headline)+'</div><div class="meta">السعر: $'+Number(x.price||0).toFixed(2)+' · التغير: '+Number(x.change||0).toFixed(2)+'%</div><div class="summary">'+esc(x.summary||"")+'</div><a class="link" href="'+esc(x.url||"#")+'" target="_blank" rel="noopener">فتح المصدر ↗</a></article>'}).join("")}
$("status").textContent="آخر تحديث: "+new Date().toLocaleTimeString("ar-SA")}catch(e){$("status").textContent="خطأ: "+e.message}
$("refresh").disabled=false}
$("refresh").onclick=load;load(); setInterval(load,5*60*1000);
</script></body></html>`;

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json;charset=UTF-8","cache-control":"no-store"}})}
async function telegram(text,env){
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return;
 const u="https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage";
 try{await fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text,disable_web_page_preview:true})})}catch(_){}
}
function normalizeHeadline(s){return (s||"").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g," ").trim()}
function isHot(s){return /fda|approval|approved|contract|agreement|acquisition|acquire|merger|offering|trial|clinical|partnership|deal|guidance|results|award|order|launch|investigation|bankruptcy|default|delisting/i.test(s||"")}
function isCompanyCatalyst(s){
 const t=String(s||"").toLowerCase();
 const genericMover=["trending:","here's why","heres why","why shares are trading","why the stock is","why shares are","rocketed","dow jumps","nasdaq","s&p 500","trade deficit","u.s. stocks","us stocks","market roundup","market update","market recap","market news","market movers","pre-market movers","premarket movers","after-hours movers","stocks moving"];
 if(genericMover.some(k=>t.includes(k)))return false;
 const good=[
  "fda","approval","approved","clearance","clinical","trial","phase 1","phase 2","phase 3",
  "contract","agreement","partnership","collaboration","acquisition","acquire","merger",
  "license","licensing","order","purchase order","award","launch","milestone",
  "earnings","revenue","guidance","forecast","results","data","study","patent",
  "nasdaq","listing","uplisting","compliance","financing","offering","private placement",
  "registered direct","atm","shelf","sec","10-k","10-q","8-k","shareholder","dividend",
  "buyback","repurchase","strategic","investment","funding","debt","restructuring",
  "bankruptcy","default","investigation","lawsuit","settlement","recall","resigns",
  "appoints","ceo","cfo","cmo","manufacturing","production","revenue"
 ];
 const bad=[
  "gap-up","gap up","gap-down","gap down","notable gap","stocks to watch",
  "market roundup","market update","market recap","pre-market movers","premarket movers",
  "top gainers","top losers","technical analysis","price target","stock analysis",
  "stocks making","market movers","market news","today's session","today’s session",
  "stocks moving premarket","stocks moving after hours","here are 20 stocks","20 stocks moving",
  "stocks moving","premarket stocks","after-hours stocks"
 ];
 return good.some(k=>t.includes(k)) && !bad.some(k=>t.includes(k));
}
function companyMentioned(symbol,name,text){
 const t=String(text||"").toLowerCase();
 const sym=String(symbol||"").toLowerCase();
 if(sym && new RegExp("(^|\\W)"+sym.replace(/[.*+?^$()|[\\]\\\\]/g,"\\\\$&")+"(\\W|$)","i").test(t)) return true;
 const n=String(name||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
 if(!n)return false;
 if(t.includes(n))return true;
 const words=n.split(/\\s+/).filter(w=>w.length>=4);
 if(words.length>=2){
   const hits=words.filter(w=>t.includes(w)).length;
   return hits>=2;
 }
 return words.length===1 && words[0].length>=7 && t.includes(words[0]);
}



async function getJson(url){const r=await fetch(url,{headers:{"accept":"application/json"}});if(!r.ok)throw new Error("Finnhub HTTP "+r.status);return r.json()}

async function getNasdaqRows(exchange){
 const u="https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=500&offset=0&exchange="+exchange+"&download=true";
 const r=await fetch(u,{headers:{
  "accept":"application/json,text/plain,*/*",
  "accept-language":"en-US,en;q=0.9",
  "origin":"https://www.nasdaq.com",
  "referer":"https://www.nasdaq.com/market-activity/stocks/screener",
  "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36"
 }});
 if(!r.ok)throw new Error("NASDAQ HTTP "+r.status);
 const d=await r.json();
 return Array.isArray(d?.data?.rows)?d.data.rows:[];
}

function num(v){
 const s=String(v??"").replace(/[$,% ,]/g,"").trim();
 const n=Number(s);return Number.isFinite(n)?n:0;
}

const GLOBE_RSS="https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies";
const PR_RSS="https://www.prnewswire.com/rss/news-releases-list.rss";

function xmlUnescape(s){
 return String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
  .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
  .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
}
function stripHtml(s){return xmlUnescape(s).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}
function xmlField(block,name){
 const re=new RegExp("<(?:[\\w-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?" + name + ">","i");
 const m=block.match(re); return m?xmlUnescape(m[1]).trim():"";
}
function xmlLink(block){
 const a=block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
 if(a)return xmlUnescape(a[1]);
 return xmlField(block,"link").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
}
function extractSymbols(text,universe){
 const out=new Set(), t=stripHtml(text);
 let m;
 const re1=/\b(?:NASDAQ|NYSE|NYSEAMERICAN|AMEX|OTCQX|OTCQB|OTC):\s*([A-Z]{1,6})\b/gi;
 while((m=re1.exec(t)))out.add(m[1].toUpperCase());
 const re2=/\$([A-Z]{1,6})\b/g;
 while((m=re2.exec(t)))out.add(m[1].toUpperCase());
 const re3=/\(([A-Z]{1,6})\)/g;
 while((m=re3.exec(t)))if(universe.has(m[1]))out.add(m[1]);
 return [...out].filter(s=>universe.has(s));
}
function parseRss(xml,source,universe){
 const blocks=[...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].map(x=>x[1]);
 const out=[];
 for(const b of blocks){
  const headline=stripHtml(xmlField(b,"title"));
  const summary=stripHtml(xmlField(b,"description")||xmlField(b,"summary")||xmlField(b,"content"));
  const url=xmlLink(b)||xmlField(b,"guid");
  const pub=xmlField(b,"pubDate")||xmlField(b,"published")||xmlField(b,"updated");
  const issuer=stripHtml(xmlField(b,"contributor")||xmlField(b,"creator")||xmlField(b,"author"));
  const text=headline+" "+summary+" "+issuer+" "+b;
  const symbols=extractSymbols(text,universe);
  const ts=Date.parse(pub);
  if(!headline||!Number.isFinite(ts))continue;
  out.push({headline,summary,url,issuer,symbols,raw:b,datetime:Math.floor(ts/1000),source});
 }
 return out;
}
async function fetchFeed(url,source){
 try{
  const r=await fetch(url,{headers:{"user-agent":"KhalidStockNews/1.0","accept":"application/rss+xml,application/atom+xml,text/xml,*/*"}});
  if(!r.ok)return[];
  return parseRss(await r.text(),source,new Map());
 }catch(_){return[]}
}
function isBadWireStory(s){
 const t=String(s||"").toLowerCase();
 return [
  "stocks to watch","stocks moving","top gainers","top losers","market roundup",
  "market update","market recap","market movers","premarket movers","pre-market movers",
  "after-hours movers","here are 20 stocks","20 stocks moving","price target",
  "stock analysis","technical analysis","equity alert","investigation deadline",
  "class action","law firm","attorneys","investor alert","shares tank","why shares",
  "trending:"
 ].some(k=>t.includes(k));
}
function isCatalyst(s){
 const t=String(s||"").toLowerCase();
 return [
  "fda","approval","approved","clearance","clinical","phase 1","phase 2","phase 3",
  "trial","contract","agreement","partnership","collaboration","acquisition","acquire",
  "merger","license","licensing","order","purchase order","award","launch","milestone",
  "earnings","revenue","guidance","forecast","results","data","study","patent",
  "uplisting","nasdaq","compliance","financing","offering","private placement",
  "registered direct","atm","sec","10-k","10-q","8-k","shareholder","dividend",
  "buyback","repurchase","strategic","investment","funding","debt","restructuring",
  "bankruptcy","default","delisting","investigation","lawsuit","settlement","recall",
  "resigns","appoints","ceo","cfo","cmo","manufacturing","production"
 ].some(k=>t.includes(k));
}
async function news(env,notify=false){
 const now=Math.floor(Date.now()/1000);
 const rs=await Promise.allSettled(["NASDAQ","NYSE","AMEX"].map(getNasdaqRows));
 const universe=new Map();
 for(const r of rs)if(r.status==="fulfilled")for(const x of r.value){
   const symbol=String(x.symbol||x.Symbol||"").trim().toUpperCase();
   const price=num(x.lastsale??x["Last Sale"]??x.lastSale);
   const volume=num(x.volume??x.Volume);
   if(!/^[A-Z]{1,6}$/.test(symbol)||!(price>=1&&price<=7))continue;
   universe.set(symbol,{price,volume,name:x.name??x.Name??""});
 }
 const feeds=await Promise.all([
   fetchFeed(GLOBE_RSS,"GlobeNewswire"),
   fetchFeed(PR_RSS,"PR Newswire")
 ]);
 const raw=feeds.flat().map(x=>{
   const symbols=extractSymbols(x.headline+" "+x.summary+" "+x.issuer+" "+x.url+" "+x.raw,universe);
   return {...x,symbols};
 }).filter(x=>x.symbols.length&&now-x.datetime<=86400);
 const items=[];
 for(const x of raw){
   if(isBadWireStory(x.headline+" "+x.summary))continue;
   const text=x.headline+" "+x.summary+" "+x.issuer;
   if(!isCatalyst(text))continue;
   for(const symbol of x.symbols){
     const q=universe.get(symbol);
     if(!q)continue;
     items.push({
       symbol,headline:x.headline,summary:x.summary,url:x.url,source:x.source,
       datetime:x.datetime,price:q.price,change:0,volume:q.volume,
       name:q.name,hot:isHot(text),freshness:now-x.datetime<=900?"جديد جدًا":now-x.datetime<=3600?"آخر ساعة":"اليوم"
     });
   }
 }
 const seen=new Set();
 const out=items.filter(x=>{
   const k=x.symbol+"|"+normalizeHeadline(x.headline);
   if(seen.has(k))return false;
   seen.add(k);return true;
 });
 out.sort((a,b)=>(Number(b.hot)-Number(a.hot))||(b.datetime-a.datetime)||(b.volume-a.volume));
 if(notify&&out.length){
   const fresh=out.filter(x=>now-x.datetime<=600).slice(0,5);
   for(const x of fresh){
     const tone=/fda|approval|approved|contract|agreement|acquisition|merger|partnership|deal|award|order|launch|results/i.test(x.headline+" "+x.summary)?"🟢 إيجابي":"🟡 خبر";
     await telegram("📰 خبر مباشر — $"+x.symbol+"\n"+tone+"\n"+x.headline+"\n💰 السعر: $"+Number(x.price).toFixed(2)+"\n📡 "+x.source+"\n⏱️ "+Math.max(0,Math.floor((now-x.datetime)/60))+" دقيقة\n"+x.url,env);
   }
 }
 return json({
   stats:{matching:out.length,lastHour:out.filter(x=>now-x.datetime<=3600).length,hot:out.filter(x=>x.hot).length,universe:universe.size,scanned:out.length},
   items:out.slice(0,50),
   note:"المصدر الأساسي الآن نشرات الشركات المباشرة عبر GlobeNewswire وPR Newswire. السعر يُفلتر من Nasdaq/NYSE/AMEX بين $1 و$7، وتُستبعد أخبار القوائم والسوق العامة والتنبيهات الترويجية."
 });
}

export default {
 async fetch(request,env){
   const url=new URL(request.url);
   if(url.pathname==="/api/news")return news(env).catch(e=>json({error:e.message},500));
   if(url.pathname==="/favicon.ico")return new Response("",{status:204});
   if(url.pathname==="/api/test-telegram"){await telegram("✅ تم ربط تنبيهات الأخبار بنجاح.",env);return json({ok:true})}
   return new Response(HTML,{headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store"}});
 },
 async scheduled(event,env,ctx){
   ctx.waitUntil(news(env,true).catch(()=>{}));
 }
};