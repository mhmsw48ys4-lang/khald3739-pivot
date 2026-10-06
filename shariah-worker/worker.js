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
function normalizeHeadline(s){return (s||"").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g," ").trim()}
function isHot(s){return /fda|approval|approved|contract|agreement|acquisition|acquire|merger|offering|trial|clinical|partnership|deal|guidance|results|award|order|launch|investigation|bankruptcy|default|delisting/i.test(s||"")}

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

async function news(env){
 if(!env.FINNHUB_API_KEY)return json({error:"FINNHUB_API_KEY غير موجود في Cloudflare Worker Secrets"},500);
 const key=env.FINNHUB_API_KEY, now=Math.floor(Date.now()/1000);
 const today=new Date().toISOString().slice(0,10);
 const from=new Date(Date.now()-24*3600*1000).toISOString().slice(0,10);

 // نبدأ من قائمة الأسهم نفسها، وليس من الأخبار. نستخدم Nasdaq كمصدر universe
 // ثم نرتب أسهم $1-$7 حسب النشاط ونفحص Company News في Finnhub.
 const rs=await Promise.allSettled(["NASDAQ","NYSE","AMEX"].map(getNasdaqRows));
 const universe=new Map();
 for(const r of rs)if(r.status==="fulfilled")for(const x of r.value){
   const symbol=String(x.symbol||x.Symbol||"").trim().toUpperCase();
   const price=num(x.lastsale??x["Last Sale"]??x.lastSale);
   const volume=num(x.volume??x.Volume);
   if(!/^[A-Z]{1,6}$/.test(symbol)||!(price>=1&&price<=7))continue;
   universe.set(symbol,{price,volume,name:x.name??x.Name??""});
 }

 // نضيف الرموز التي ظهرت في الأخبار كاحتياط، لكن لا نعتمد عليها لاكتشاف السوق.
 try{
   const feed=await getJson(FINNHUB_BASE+"/news?category=general&token="+encodeURIComponent(key));
   if(Array.isArray(feed))for(const n of feed){
     const rel=Array.isArray(n.related)?n.related:(typeof n.related==="string"?n.related.split(","):[]);
     for(const s0 of rel){
       const s=String(s0||"").trim().toUpperCase();
       if(/^[A-Z]{1,6}$/.test(s)&&!universe.has(s))universe.set(s,{price:0,volume:0,name:""});
     }
   }
 }catch(_){}

 const base=[...universe.entries()].filter(([,x])=>x.price>=1&&x.price<=7);
 base.sort((a,b)=>b[1].volume-a[1].volume);
 const syms=base.slice(0,120).map(([s])=>s);
 const items=[];

 async function one(symbol){
  try{
   const q=await getJson(FINNHUB_BASE+"/quote?symbol="+encodeURIComponent(symbol)+"&token="+encodeURIComponent(key));
   const price=Number(q.c);
   if(!(price>=1&&price<=7))return;
   const ns=await getJson(FINNHUB_BASE+"/company-news?symbol="+encodeURIComponent(symbol)+"&from="+from+"&to="+today+"&token="+encodeURIComponent(key));
   for(const n of (Array.isArray(ns)?ns:[])){
     const ts=Number(n.datetime||0);
     if(!ts||now-ts>86400||!n.headline)continue;
     const text=n.headline+" "+(n.summary||"");
     items.push({
       symbol,headline:n.headline,summary:n.summary||"",source:n.source||"",url:n.url||"",
       datetime:ts,price,change:Number(q.dp||0),
       volume:universe.get(symbol)?.volume||0,
       hot:isHot(text),
       freshness:now-ts<=900?"جديد جدًا":now-ts<=3600?"آخر ساعة":"اليوم"
     });
   }
  }catch(_){}
 }

 // دفعات صغيرة حتى لا نتجاوز حدود Finnhub.
 for(let i=0;i<syms.length;i+=6)await Promise.all(syms.slice(i,i+6).map(one));

 const seen=new Set();
 const out=items.filter(x=>{
   const k=x.symbol+"|"+normalizeHeadline(x.headline);
   if(seen.has(k))return false;seen.add(k);return true;
 });
 out.sort((a,b)=>b.datetime-a.datetime || b.volume-a.volume);

 return json({
  stats:{
   matching:out.length,lastHour:out.filter(x=>now-x.datetime<=3600).length,
   hot:out.filter(x=>x.hot).length,universe:base.length,scanned:syms.length
  },
  items:out.slice(0,50),
  note:"المصدر يبدأ من قائمة أسهم Nasdaq/NYSE/AMEX بسعر $1-$7 ثم يفحص Company News. الفحص يركز على الأسهم الأعلى نشاطًا ضمن النطاق لتفادي حدود API؛ «حصري» غير مضمون."
 });
}

export default {
 async fetch(request,env){
   const url=new URL(request.url);
   if(url.pathname==="/api/news")return news(env).catch(e=>json({error:e.message},500));
   if(url.pathname==="/favicon.ico")return new Response("",{status:204});
   return new Response(HTML,{headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store"}});
 }
};