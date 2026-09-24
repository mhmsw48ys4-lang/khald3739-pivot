const SEC_UA = "khald3739-pivot/2.0 contact@khald3739-pivot.workers.dev";
const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type"
};

const LIMITS = { debt: 30, deposits: 30, prohibited: 5 };

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8", ...CORS}
  });
}
function num(v){
  if(v===null || v===undefined || v==="") return null;
  const n = Number(String(v).replace(/,/g,"").replace(/\$/g,""));
  return Number.isFinite(n) ? n : null;
}
function pct(a,b){
  return a==null || b==null || !b ? null : (a/b)*100;
}
function clean(s){
  return String(s??"")
    .replace(/&nbsp;/gi," ")
    .replace(/&#39;/gi,"'")
    .replace(/&amp;/gi,"&")
    .replace(/<[^>]*>/g," ")
    .replace(/\s+/g," ")
    .trim();
}
function upper(s){ return String(s||"").trim().toUpperCase(); }

async function sec(url){
  const r = await fetch(url, {
    headers: {
      "User-Agent": SEC_UA,
      "Accept":"application/json,text/html;q=0.9,*/*;q=0.8"
    }
  });
  return r;
}

async function getCik(symbol){
  const requested = upper(symbol);
  const aliases = {MBTO:"MBOT"};
  const target = aliases[requested] || requested;
  const r = await sec("https://www.sec.gov/files/company_tickers.json");
  if(!r.ok) throw Error("تعذر الوصول إلى SEC");
  const j = await r.json();
  for(const x of Object.values(j)){
    if(upper(x.ticker)===target){
      return {
        cik:String(x.cik_str).padStart(10,"0"),
        ticker:target,
        name:x.title || target
      };
    }
  }
  throw Error("السهم غير موجود في بيانات SEC");
}

function chooseFiling(recent){
  for(let i=0;i<(recent.form||[]).length;i++){
    const form=recent.form[i];
    if(form==="10-Q" || form==="10-K"){
      return {
        form,
        accn:recent.accessionNumber[i],
        filingDate:recent.filingDate[i],
        reportDate:recent.reportDate[i],
        doc:recent.primaryDocument[i]
      };
    }
  }
  return null;
}

function factsFor(facts, tags){
  for(const tag of tags){
    const f=facts?.["us-gaap"]?.[tag] || facts?.dei?.[tag];
    if(f) return {tag, fact:f};
  }
  return null;
}

function instantFact(facts,tags,accn,end=null){
  const found=factsFor(facts,tags);
  if(!found) return null;
  const units=Object.values(found.fact.units||{}).flat();
  let hits=units.filter(x=>x.accn===accn && (!end || x.end===end));
  if(!hits.length) return null;
  hits.sort((a,b)=>String(b.filed||"").localeCompare(String(a.filed||"")));
  return {value:num(hits[0].val), tag:found.tag};
}

function durationFact(facts,tags,accn,end,form,targetDays){
  const candidates=[];
  for(const tag of tags){
    const f=facts?.["us-gaap"]?.[tag];
    if(!f) continue;
    for(const unit of Object.values(f.units||{})){
      for(const x of unit){
        if(x.accn!==accn || x.end!==end || !x.start) continue;
        if(form && x.form!==form) continue;
        const days=Math.round((new Date(x.end+"T00:00:00Z")-new Date(x.start+"T00:00:00Z"))/86400000);
        if(days>0) candidates.push({value:num(x.val),tag,days,unit:x.unit});
      }
    }
  }
  if(!candidates.length && form) return durationFact(facts,tags,accn,end,null,targetDays);
  if(!candidates.length) return null;
  candidates.sort((a,b)=>{
    const da=Math.abs(a.days-targetDays), db=Math.abs(b.days-targetDays);
    return da-db;
  });
  return candidates[0];
}

function tableRows(html){
  const rows=[];
  const tr=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while((m=tr.exec(html))){
    const cells=[];
    const td=/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while((c=td.exec(m[1]))) cells.push(clean(c[1]));
    if(cells.length) rows.push(cells);
  }
  return rows;
}

function rowNumber(rows, regexes){
  for(const row of rows){
    if(!row[0]) continue;
    if(!regexes.some(re=>re.test(row[0]))) continue;
    for(let i=1;i<row.length;i++){
      const raw=row[i]
        .replace(/\$/g,"")
        .replace(/,/g,"")
        .replace(/\(([^)]+)\)/,"-$1")
        .trim();
      const n=num(raw);
      if(n!==null) return n;
    }
  }
  return null;
}

function sumUnique(values){
  const xs=values.filter(v=>v!=null);
  if(!xs.length) return null;
  return xs.reduce((a,b)=>a+b,0);
}

function debtFromFacts(facts,accn,end){
  const totalTags=[
    "LongTermDebtAndFinanceLeaseObligations",
    "LongTermDebt",
    "ConvertibleNotesPayable",
    "NotesPayable"
  ];
  const currentTags=[
    "LongTermDebtCurrent",
    "LongTermDebtAndFinanceLeaseObligationsCurrent",
    "ConvertibleNotesPayableCurrent",
    "NotesPayableCurrent"
  ];
  const noncurrentTags=[
    "LongTermDebtNoncurrent",
    "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
    "ConvertibleNotesPayableNoncurrent",
    "NotesPayableNoncurrent"
  ];
  for(const tag of totalTags){
    const x=instantFact(facts,[tag],accn,end);
    if(x?.value!=null) return x.value;
  }
  return sumUnique([
    instantFact(facts,currentTags,accn,end)?.value,
    instantFact(facts,noncurrentTags,accn,end)?.value
  ]);
}

async function marketPrice(symbol){
  const urls=[
    "https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?range=1d&interval=1d",
    "https://query2.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?range=1d&interval=1d"
  ];
  for(const url of urls){
    try{
      const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"}});
      if(!r.ok) continue;
      const j=await r.json();
      const p=num(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
      if(p!=null) return p;
    }catch{}
  }
  return null;
}

async function scan(input){
  const found=await getCik(input);
  const subR=await sec("https://data.sec.gov/submissions/CIK"+found.cik+".json");
  if(!subR.ok) throw Error("تعذر قراءة إفصاحات الشركة");
  const sub=await subR.json();
  const filing=chooseFiling(sub.filings?.recent||{});
  if(!filing) throw Error("لا يوجد 10-Q أو 10-K حديث");

  const cfR=await sec("https://data.sec.gov/api/xbrl/companyfacts/CIK"+found.cik+".json");
  if(!cfR.ok) throw Error("تعذر قراءة بيانات XBRL");
  const facts=(await cfR.json()).facts||{};

  const filingUrl="https://www.sec.gov/Archives/edgar/data/"+Number(found.cik)+"/"+filing.accn.replace(/-/g,"")+"/"+filing.doc;
  let html="";
  try{
    const fr=await sec(filingUrl);
    if(fr.ok) html=await fr.text();
  }catch{}
  const rows=tableRows(html);

  const targetDays=filing.form==="10-K"?365:91;
  const end=filing.reportDate;

  let shares=instantFact(facts,["EntityCommonStockSharesOutstanding"],filing.accn)?.value;
  if(shares==null){
    const text=clean(html);
    const m=text.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s+shares of common stock/i)
      || text.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s+shares issued and outstanding/i);
    if(m) shares=num(m[1]);
  }

  const rev=durationFact(
    facts,
    ["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","SalesRevenueGoodsNet"],
    filing.accn,end,filing.form,targetDays
  );
  const revenue=rowNumber(rows,[/^revenues?$/i,/^sales$/i,/^net sales$/i]) ?? rev?.value ?? null;

  const interest=durationFact(
    facts,
    ["InterestIncomeNonoperating","InterestIncome","InvestmentIncomeInterest"],
    filing.accn,end,filing.form,targetDays
  );
  const interestIncome=rowNumber(rows,[/^interest income(?:, net)?$/i,/^interest income$/i]) ?? interest?.value ?? null;

  const financingIncome=rowNumber(rows,[/^financing income(?:, net)?$/i,/^financing income$/i]);

  let debt=debtFromFacts(facts,filing.accn,end);
  if(debt==null){
    debt=rowNumber(rows,[
      /interest[- ]bearing debt/i,
      /long[- ]term debt/i,
      /convertible notes? payable/i,
      /notes? payable/i,
      /lease liabilities/i
    ]);
  }

  const deposits=rowNumber(rows,[
    /interest[- ]bearing deposits?/i,
    /interest[- ]bearing securities/i,
    /interest[- ]bearing investments?/i
  ]);

  const price=await marketPrice(found.ticker);
  const marketCap=price!=null && shares!=null ? price*shares : null;

  const debtPct=pct(debt,marketCap);
  const depositsPct=pct(deposits,marketCap);
  const prohibitedPct=pct(interestIncome,revenue);
  const financingPct=pct(financingIncome,revenue);

  const checks={
    debt:debtPct==null?null:debtPct<=LIMITS.debt,
    deposits:depositsPct==null?null:depositsPct<=LIMITS.deposits,
    prohibited:prohibitedPct==null?null:prohibitedPct<=LIMITS.prohibited
  };

  const known=Object.values(checks).filter(v=>v!==null);
  const overall=known.length===3 ? known.every(Boolean) : null;

  return {
    symbol:found.ticker,
    requestedSymbol:upper(input),
    company:sub.name||found.name,
    form:filing.form,
    filingDate:filing.filingDate,
    reportDate:filing.reportDate,
    accession:filing.accn,
    filingUrl,
    price,shares,marketCap,
    revenue,
    debt,debtPct,
    deposits,depositsPct,
    interestIncome,prohibitedPct,
    financingIncome,financingPct,
    checks,
    overall,
    limits:LIMITS,
    periodDays:rev?.days ?? interest?.days ?? null,
    source:"SEC EDGAR + Yahoo Finance",
    note: interestIncome==null
      ? (financingIncome!=null
        ? "لم يظهر رقم مستقل لدخل الفوائد؛ دخل التمويل المعروض مؤشر بديل ولا يُستخدم للحكم النهائي على بند الدخل المحرم."
        : "لم يظهر رقم مستقل واضح لدخل الفوائد في الإفصاح.")
      : "نسبة الدخل المحرم محسوبة من دخل الفوائد المستقل ÷ الإيرادات."
  };
}

const HTML=String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>فاحص شرعية الأسهم</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#07111f;color:#f7f9fc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:760px;margin:auto;padding:28px 18px 50px}
h1{font-size:30px;margin:10px 0 8px}
.subtitle{color:#9eafc4;line-height:1.8;margin:0 0 22px}
.search{display:flex;gap:10px}
input{flex:1;min-width:0;background:#fff;color:#111;border:0;border-radius:15px;padding:16px;font-size:20px;text-transform:uppercase}
button{width:130px;border:0;border-radius:15px;background:#2f80ed;color:#fff;font-size:19px;font-weight:700}
button:disabled{opacity:.6}
.card{background:#101d2e;border:1px solid #172a40;border-radius:20px;padding:18px;margin-top:18px;box-shadow:0 10px 35px #0002}
.title{font-size:26px;font-weight:800;margin-bottom:4px}
.company{color:#aebdd0;margin-bottom:16px}
.row{display:flex;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid #23354b;align-items:center}
.row:last-child{border-bottom:0}
.label{color:#b7c4d5}
.value{text-align:left;font-weight:650}
.pass{color:#4ade80}.fail{color:#f87171}.warn{color:#fbbf24}
.summary{font-size:21px;font-weight:800;padding:16px;border-radius:14px;margin-bottom:12px}
.summary.pass{background:#0c2b1c}.summary.warn{background:#33250b}.summary.fail{background:#321317}
.note{color:#aab8c9;line-height:1.8;margin:14px 0 0}
.small{font-size:13px;color:#8294aa;line-height:1.7}
a{color:#69a7ff;text-decoration:none}
.loading{color:#b7c4d5;text-align:center;padding:20px}
</style>
</head>
<body>
<main>
<h1>فاحص شرعية الأسهم</h1>
<p class="subtitle">يفحص أحدث 10-Q أو 10-K من SEC ويعرض النسب والبيانات المستخدمة بدل التخمين عند نقص الإفصاح.</p>
<div class="search">
<input id="symbol" placeholder="مثال MBOT" autocomplete="off">
<button id="scanBtn" onclick="scanStock()">فحص</button>
</div>
<div id="out"></div>
</main>
<script>
const out=document.getElementById("out"), input=document.getElementById("symbol"), btn=document.getElementById("scanBtn");
input.addEventListener("keydown",e=>{if(e.key==="Enter")scanStock()});
const money=v=>v==null?"بيانات غير كافية":"$"+Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
const percent=v=>v==null?"بيانات غير كافية":Number(v).toFixed(2)+"%";
const status=v=>v==null?'<span class="warn">بيانات غير كافية</span>':v?'<span class="pass">اجتاز</span>':'<span class="fail">لم يجتز</span>';
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}
function overall(x){
  if(x.overall===true)return '<div class="summary pass">النتيجة: جميع البنود المتاحة ضمن الحدود</div>';
  if(x.overall===false)return '<div class="summary fail">النتيجة: يوجد بند تجاوز الحد</div>';
  return '<div class="summary warn">النتيجة: تحتاج مراجعة — بعض البيانات غير متاحة</div>';
}
async function scanStock(){
  const s=input.value.trim().toUpperCase();
  if(!s)return;
  btn.disabled=true; out.innerHTML='<div class="card loading">جاري قراءة SEC وحساب النسب...</div>';
  try{
    const r=await fetch("/api/scan?symbol="+encodeURIComponent(s),{cache:"no-store"});
    const x=await r.json();
    if(!r.ok)throw Error(x.error||"فشل الفحص");
    out.innerHTML='<div class="card">'+
      overall(x)+
      '<div class="title">'+esc(x.symbol)+'</div>'+
      '<div class="company">'+esc(x.company)+'</div>'+
      '<div class="row"><span class="label">التقرير</span><span class="value">'+esc(x.form)+" — "+esc(x.reportDate)+'</span></div>'+
      '<div class="row"><span class="label">السعر</span><span class="value">'+money(x.price)+'</span></div>'+
      '<div class="row"><span class="label">عدد الأسهم</span><span class="value">'+(x.shares==null?"بيانات غير كافية":Number(x.shares).toLocaleString())+'</span></div>'+
      '<div class="row"><span class="label">القيمة السوقية</span><span class="value">'+money(x.marketCap)+'</span></div>'+
      '<div class="row"><span class="label">الدين</span><span class="value">'+money(x.debt)+' — '+percent(x.debtPct)+' '+status(x.checks.debt)+'</span></div>'+
      '<div class="row"><span class="label">ودائع بفائدة معلنة</span><span class="value">'+money(x.deposits)+' — '+percent(x.depositsPct)+' '+status(x.checks.deposits)+'</span></div>'+
      '<div class="row"><span class="label">الإيرادات</span><span class="value">'+money(x.revenue)+'</span></div>'+
      '<div class="row"><span class="label">دخل فوائد مستقل</span><span class="value">'+money(x.interestIncome)+' — '+percent(x.prohibitedPct)+' '+status(x.checks.prohibited)+'</span></div>'+
      '<div class="row"><span class="label">دخل التمويل (مؤشر)</span><span class="value">'+money(x.financingIncome)+' — '+percent(x.financingPct)+'</span></div>'+
      '<p class="note">'+esc(x.note)+'</p>'+
      '<p class="small">الحدود المستخدمة: الدين '+x.limits.debt+'%، الودائع '+x.limits.deposits+'%، الدخل المحرم '+x.limits.prohibited+'%. هذه أداة فحص وليست فتوى.</p>'+
      '<p class="small"><a href="'+esc(x.filingUrl)+'" target="_blank" rel="noopener">فتح الإفصاح الرسمي في SEC</a></p>'+
      '</div>';
  }catch(e){
    out.innerHTML='<div class="card"><div class="fail">'+esc(e.message)+'</div></div>';
  }finally{btn.disabled=false}
}
</script>
</body>
</html>`;

export default {
  async fetch(request){
    if(request.method==="OPTIONS") return new Response(null,{headers:CORS});
    const url=new URL(request.url);
    if(url.pathname==="/api/scan"){
      try{
        const symbol=(url.searchParams.get("symbol")||"").trim();
        if(!/^[A-Za-z.]{1,8}$/.test(symbol)) return json({error:"أدخل رمز سهم صحيح"},400);
        return json(await scan(symbol));
      }catch(e){
        return json({error:e?.message||"فشل الفحص"},500);
      }
    }
    return new Response(HTML,{
      headers:{
        "content-type":"text/html;charset=UTF-8",
        "cache-control":"no-store"
      }
    });
  }
};
