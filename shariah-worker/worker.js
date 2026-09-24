const SEC_UA = "khald3739-pivot/1.0 contact@example.com";
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8",...CORS}});
}
function money(v){ if(v==null)return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function norm(s){return String(s??"").toLowerCase().replace(/&nbsp;/g," ").replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
function pct(a,b){return a==null||b==null||!b?null:a/b*100;}
function pickFact(facts,tags,accn,end,form){
  for(const tag of tags){
    const f=facts?.["us-gaap"]?.[tag]||facts?.dei?.[tag];
    if(!f)continue;
    const units=Object.values(f.units||{}).flat();
    const hit=units.filter(x=>x.accn===accn && (!form||x.form===form) && (!end||x.end===end));
    if(hit.length)return hit.sort((a,b)=>String(b.filed).localeCompare(String(a.filed)))[0];
  }
  return null;
}
function instantFact(facts,tags,accn,end,form){
  const f=pickFact(facts,tags,accn,end,form); return f?.val!=null?money(f.val):null;
}
function durationFact(facts,tags,accn,start,end,form){
  for(const tag of tags){
    const f=facts?.["us-gaap"]?.[tag];
    if(!f)continue;
    const units=Object.values(f.units||{}).flat();
    const hits=units.filter(x=>x.accn===accn&&(!form||x.form===form)&&x.start===start&&x.end===end);
    if(hits.length)return hits.sort((a,b)=>String(b.filed).localeCompare(String(a.filed)))[0];
  }
  return null;
}
function stripTable(html){
  const rows=[]; const re=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi; let m;
  while((m=re.exec(html))){const cells=[];const cr=/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;let c;while((c=cr.exec(m[1])))cells.push(norm(c[1]));if(cells.length)rows.push(cells);}
  return rows;
}
function rowValue(rows,patterns){
  for(const r of rows){
    if(!r[0])continue;
    if(patterns.some(p=>p.test(r[0]))){
      for(let i=1;i<r.length;i++){
        const s=r[i].replace(/\$/g,"").replace(/,/g,"").replace(/\(([^)]+)\)/,"-$1").trim();
        const n=Number(s); if(Number.isFinite(n))return n;
      }
    }
  }
  return null;
}
async function sec(url){return fetch(url,{headers:{"User-Agent":SEC_UA,"Accept-Encoding":"gzip, deflate"}});}
async function getCik(symbol){
  const r=await sec("https://www.sec.gov/files/company_tickers.json"); if(!r.ok)throw Error("SEC ticker lookup failed");
  const j=await r.json(); const s=symbol.toUpperCase();
  for(const x of Object.values(j))if(String(x.ticker).toUpperCase()===s)return String(x.cik_str).padStart(10,"0");
  throw Error("Ticker not found in SEC");
}
async function scan(symbol){
  const cik=await getCik(symbol);
  const subR=await sec("https://data.sec.gov/submissions/CIK"+cik+".json"); if(!subR.ok)throw Error("SEC submissions failed");
  const sub=await subR.json(), r=sub.filings?.recent||{};
  let ix=-1;
  for(let i=0;i<r.form.length;i++){if(["10-Q","10-K"].includes(r.form[i])&&!String(r.accessionNumber[i]).includes("8-K")){ix=i;break;}}
  if(ix<0)throw Error("No 10-Q/10-K found");
  const form=r.form[ix], accn=r.accessionNumber[ix], filingDate=r.filingDate[ix], reportDate=r.reportDate[ix], doc=r.primaryDocument[ix];
  const cfR=await sec("https://data.sec.gov/api/xbrl/companyfacts/CIK"+cik+".json"); if(!cfR.ok)throw Error("SEC companyfacts failed");
  const cf=await cfR.json(), facts=cf.facts||{};
  const filingUrl="https://www.sec.gov/Archives/edgar/data/"+Number(cik)+"/"+accn.replace(/-/g,"")+"/"+doc;
  let rows=[]; try{const fr=await sec(filingUrl);if(fr.ok)rows=stripTable(await fr.text());}catch{}
  const end=reportDate;
  const shares=instantFact(facts,["EntityCommonStockSharesOutstanding"],accn,null,form)??instantFact(facts,["EntityCommonStockSharesOutstanding"],accn,end,form);
  const revenueFact=durationFact(facts,["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","SalesRevenueGoodsNet"],accn,findStart(facts,accn,end,form),end,form);
  const revenue=rowValue(rows,[/^revenues?$/i,/^sales$/i,/^net sales$/i])??(revenueFact?.val!=null?money(revenueFact.val):null);
  const interestFact=durationFact(facts,["InterestIncomeNonoperating","InterestIncome","InvestmentIncomeInterest"],accn,findStart(facts,accn,end,form),end,form);
  const interest=rowValue(rows,[/^interest income(?:, net)?$/i])??(interestFact?.val!=null?money(interestFact.val):null);
  const debtFact=instantFact(facts,["LongTermDebtCurrent","LongTermDebtNoncurrent","LongTermDebt","LongTermDebtAndFinanceLeaseObligationsCurrent","LongTermDebtAndFinanceLeaseObligationsNoncurrent"],accn,end,form);
  const debt=rowValue(rows,[/interest[- ]bearing debt/i,/long[- ]term debt/i,/convertible notes? payable/i,/notes? payable/i])??debtFact;
  const deposits=rowValue(rows,[/^interest[- ]bearing deposits?$/i,/^interest[- ]bearing securities$/i,/^interest[- ]bearing investments?$/i]);
  let price=null;
  try{const yr=await fetch("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?range=1d&interval=1d");if(yr.ok){const y=await yr.json();price=money(y.chart?.result?.[0]?.meta?.regularMarketPrice);}}catch{}
  const marketCap=price!=null&&shares!=null?price*shares:null;
  return {
    symbol:symbol.toUpperCase(),company:sub.name,form,filingDate,reportDate,accession:accn,
    price,shares,marketCap,
    debt,debtPct:pct(debt,marketCap),
    deposits,depositsPct:pct(deposits,marketCap),
    interestIncome:interest,interestPct:pct(interest,revenue),revenue,
    checks:{
      debt:debtPct(debt,marketCap,30),
      deposits:deposits==null?null:depositsPct(deposits,marketCap)<=30,
      prohibited:interest==null||revenue==null?null:interestPct(interest,revenue)<=5
    },
    note: interest==null ? "لم يظهر إفصاح مستقل واضح عن دخل الفوائد في هذا التقرير؛ لذلك لا نحكم على بند الدخل المحرم." : null
  };
}
function findStart(facts,accn,end,form){
  const tags=["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","SalesRevenueGoodsNet","InterestIncomeNonoperating","InterestIncome"];
  for(const tag of tags){const f=facts?.["us-gaap"]?.[tag];if(!f)continue;const units=Object.values(f.units||{}).flat();const x=units.find(v=>v.accn===accn&&v.end===end&&(!form||v.form===form)&&v.start);if(x)return x.start;}
  return null;
}
function debtPct(v,m,limit){const p=pct(v,m);return p==null?null:p<=limit;}
const HTML=String.raw`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فاحص شرعية الأسهم</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#07111f;color:#fff;margin:0;padding:20px}main{max-width:720px;margin:auto}h1{font-size:24px}input,button{font-size:18px;padding:14px;border-radius:12px;border:0}input{width:65%;box-sizing:border-box}button{width:30%;margin-right:5%;background:#2f80ed;color:#fff}.card{background:#101d2e;border-radius:16px;padding:18px;margin-top:16px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #26364a;padding:12px 0}.ok{color:#4ade80}.bad{color:#f87171}.warn{color:#fbbf24}.muted{color:#9fb0c4}.small{font-size:13px;line-height:1.7}</style><main><h1>فاحص شرعية الأسهم</h1><p class="muted">يعتمد على أحدث إفصاح SEC متاح، ولا يخمن عند نقص الإفصاح.</p><div><input id="s" placeholder="مثال MBOT"><button onclick="go()">فحص</button></div><div id="out"></div></main><script>async function go(){const s=document.getElementById("s").value.trim().toUpperCase();if(!s)return;out.innerHTML='<div class="card">جاري الفحص...</div>';try{const r=await fetch('/api/scan?symbol='+encodeURIComponent(s));const j=await r.json();if(!r.ok)throw Error(j.error||'فشل الفحص');const x=(v)=>v==null?'بيانات غير كافية':Number(v).toFixed(2)+'%';const mark=(v)=>v==null?'<span class="warn">بيانات غير كافية</span>':v?'<span class="ok">اجتاز</span>':'<span class="bad">لم يجتز</span>';out.innerHTML='<div class="card"><h2>'+j.symbol+'</h2><div class="row"><b>الشركة</b><span>'+j.company+'</span></div><div class="row"><b>التقرير</b><span>'+j.form+' — '+j.reportDate+'</span></div><div class="row"><b>الدين</b><span>'+x(j.debtPct)+' '+mark(j.checks.debt)+'</span></div><div class="row"><b>ودائع بفائدة معلنة</b><span>'+x(j.depositsPct)+' '+mark(j.checks.deposits)+'</span></div><div class="row"><b>دخل فوائد مستقل</b><span>'+x(j.interestPct)+' '+mark(j.checks.prohibited)+'</span></div><div class="row"><b>القيمة السوقية</b><span>'+(j.marketCap==null?'بيانات غير كافية':'$'+j.marketCap.toLocaleString())+'</span></div><p class="small muted">'+(j.note||'لا توجد ملاحظة')+'</p></div>'}catch(e){out.innerHTML='<div class="card bad">'+e.message+'</div>'}}</script></html>`;
export default {async fetch(req){if(req.method==="OPTIONS")return new Response(null,{headers:CORS});const u=new URL(req.url);if(u.pathname==="/api/scan"){try{const s=(u.searchParams.get("symbol")||"").trim();if(!/^[A-Za-z.]{1,8}$/.test(s))return json({error:"أدخل رمز سهم صحيح"},400);return json(await scan(s));}catch(e){return json({error:e.message||"فشل الفحص"},500)}}return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8"}})}};