/* DEPLOY TRIGGER: Shariah scanner ready - 2026-09-24 */
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
    let hit=units.filter(x=>x.accn===accn && (!end||x.end===end));
    if(form) { const same=hit.filter(x=>x.form===form); if(same.length) hit=same; }
    if(hit.length)return hit.sort((a,b)=>String(b.filed).localeCompare(String(a.filed)))[0];
  }
  return null;
}
function instantFact(facts,tags,accn,end,form){
  const f=pickFact(facts,tags,accn,end,form); return f?.val!=null?money(f.val):null;
}
function durationFact(facts,tags,accn,end,form,targetDays){
  const candidates=[];
  for(const tag of tags){
    const f=facts?.["us-gaap"]?.[tag]; if(!f)continue;
    const units=Object.values(f.units||{}).flat();
    for(const x of units){
      if(x.accn!==accn || x.end!==end || !x.start) continue;
      if(form && x.form!==form) continue;
      const days=Math.round((new Date(x.end+"T00:00:00Z")-new Date(x.start+"T00:00:00Z"))/86400000);
      if(days>0) candidates.push({...x,days});
    }
  }
  if(!candidates.length && form){
    return durationFact(facts,tags,accn,end,null,targetDays);
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>{
    const ad=Math.abs(a.days-(targetDays||90)), bd=Math.abs(b.days-(targetDays||90));
    return ad-bd || String(b.filed||"").localeCompare(String(a.filed||""));
  });
  return candidates[0];
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
  const j=await r.json(); let s=symbol.toUpperCase();
  // Common typo: MBTO -> MBOT (Microbot Medical)
  if(s==="MBTO")s="MBOT";
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
  let rows=[]; let filingText=""; try{const fr=await sec(filingUrl);if(fr.ok){filingText=await fr.text();rows=stripTable(filingText);}}catch{}
  const end=reportDate;
  let shares=instantFact(facts,["EntityCommonStockSharesOutstanding"],accn,null,form)??instantFact(facts,["EntityCommonStockSharesOutstanding"],accn,end,form);
  if(shares==null){
    const plain=norm(filingText);
    const sm=plain.match(/(\\d{1,3}(?:,\\d{3})+)\\s+shares of common stock[^.]{0,180}?latest practicable date/i)||plain.match(/(\\d{1,3}(?:,\\d{3})+)\\s+shares issued and outstanding/i);
    if(sm)shares=money(sm[1].replace(/,/g,""));
  }
  const targetDays=form==="10-K"?365:90;
  const revenueFact=durationFact(facts,["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","SalesRevenueGoodsNet"],accn,end,form,targetDays);
  const revenue=rowValue(rows,[/^revenues?$/i,/^sales$/i,/^net sales$/i])??(revenueFact?.val!=null?money(revenueFact.val):null);
  const interestFact=durationFact(facts,["InterestIncomeNonoperating","InterestIncome","InvestmentIncomeInterest"],accn,end,form,targetDays);
  const interest=rowValue(rows,[/^interest income(?:, net)?$/i])??(interestFact?.val!=null?money(interestFact.val):null);
  const financingIncome=rowValue(rows,[/^financing income(?:, net)?$/i]);
  const debtFact=instantFact(facts,["LongTermDebtCurrent","LongTermDebtNoncurrent","LongTermDebt","LongTermDebtAndFinanceLeaseObligationsCurrent","LongTermDebtAndFinanceLeaseObligationsNoncurrent","ConvertibleNotesPayableCurrent","ConvertibleNotesPayableNoncurrent","ConvertibleNotesPayable","NotesPayableCurrent","NotesPayableNoncurrent","NotesPayable"],accn,end,form);
  let debt=rowValue(rows,[/interest[- ]bearing debt/i,/long[- ]term debt/i,/convertible notes? payable/i,/notes? payable/i])??debtFact;
  if(debt==null){
    const leaseCurrent=rowValue(rows,[/^lease liabilities$/i]);
    const leaseLong=rowValue(rows,[/^long[- ]term lease liabilities$/i]);
    if(leaseCurrent!=null||leaseLong!=null)debt=(leaseCurrent||0)+(leaseLong||0);
  }
  const deposits=rowValue(rows,[/interest[- ]bearing deposits?/i,/interest[- ]bearing securities/i,/interest[- ]bearing investments?/i,/restricted deposit/i]);
  let price=null;
  const priceUrls=[
    "https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?range=1d&interval=1d",
    "https://query2.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?range=1d&interval=1d",
    "https://stooq.com/q/l/?s="+encodeURIComponent(symbol.toLowerCase()+".us")+"&f=sd2t2ohlcv&h&e=json"
  ];
  for(const pu of priceUrls){try{const pr=await fetch(pu,{headers:{"User-Agent":"Mozilla/5.0"}});if(!pr.ok)continue;const pj=await pr.json();price=money(pj.chart?.result?.[0]?.meta?.regularMarketPrice??pj.data?.[0]?.close);if(price!=null)break;}catch{}}
  const marketCap=price!=null&&shares!=null?price*shares:null;
  return {
    symbol:symbol.toUpperCase(),company:sub.name,form,filingDate,reportDate,accession:accn,
    price,shares,marketCap,
    debt,debtPct:pct(debt,marketCap),
    deposits,depositsPct:pct(deposits,marketCap),
    interestIncome:interest,financingIncome,interestPct:pct(interest??financingIncome,revenue),revenue,
    prohibitedSource:interest!=null?"دخل فوائد مستقل":(financingIncome!=null?"دخل تمويل صافي — مؤشر بديل؛ راجع الإفصاح":"غير متاح"),
    checks:{
      debt:debtPct(debt,marketCap,30),
      deposits:deposits==null?null:pct(deposits,marketCap)<=30,
      prohibited:(interest??financingIncome)==null||revenue==null?null:pct(interest??financingIncome,revenue)<=5
    },
    periodDays: revenueFact?.days ?? interestFact?.days ?? null,
    note: interest==null && financingIncome==null ? "لم يظهر إفصاح واضح عن دخل الفوائد أو دخل التمويل في هذا التقرير." : (interest==null && financingIncome!=null ? "لم يظهر رقم مستقل لدخل الفوائد؛ استُخدم دخل التمويل الصافي كمؤشر بديل، ويجب مراجعة تفصيل الشركة قبل الحكم النهائي." : null)
  };
}
function findStart(facts,accn,end,form){
  const tags=["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","SalesRevenueGoodsNet","InterestIncomeNonoperating","InterestIncome"];
  for(const tag of tags){const f=facts?.["us-gaap"]?.[tag];if(!f)continue;const units=Object.values(f.units||{}).flat();const x=units.find(v=>v.accn===accn&&v.end===end&&(!form||v.form===form)&&v.start);if(x)return x.start;}
  return null;
}
function debtPct(v,m,limit){const p=pct(v,m);return p==null?null:p<=limit;}
const HTML=String.raw`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فاحص شرعية الأسهم</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#07111f;color:#fff;margin:0;padding:20px}main{max-width:720px;margin:auto}h1{font-size:24px}input,button{font-size:18px;padding:14px;border-radius:12px;border:0}input{width:65%;box-sizing:border-box}button{width:30%;margin-right:5%;background:#2f80ed;color:#fff}.card{background:#101d2e;border-radius:16px;padding:18px;margin-top:16px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #26364a;padding:12px 0}.ok{color:#4ade80}.bad{color:#f87171}.warn{color:#fbbf24}.muted{color:#9fb0c4}.small{font-size:13px;line-height:1.7}</style><main><h1>فاحص شرعية الأسهم</h1><p class="muted">يعتمد على أحدث إفصاح SEC متاح، ولا يخمن عند نقص الإفصاح.</p><div><input id="s" placeholder="مثال MBOT"><button onclick="go()">فحص</button></div><div id="out"></div></main><script>async function go(){const s=document.getElementById("s").value.trim().toUpperCase();if(!s)return;out.innerHTML='<div class="card">جاري الفحص...</div>';try{const r=await fetch('/api/scan?symbol='+encodeURIComponent(s));const j=await r.json();if(!r.ok)throw Error(j.error||'فشل الفحص');const x=(v)=>v==null?'بيانات غير كافية':Number(v).toFixed(2)+'%';const usd=(v)=>v==null?'بيانات غير كافية':'$ '+Number(v).toLocaleString();const mark=(v)=>v==null?'<span class="warn">بيانات غير كافية</span>':v?'<span class="ok">اجتاز</span>':'<span class="bad">لم يجتز</span>';out.innerHTML='<div class="card"><h2>'+j.symbol+'</h2><div class="row"><b>الشركة</b><span>'+j.company+'</span></div><div class="row"><b>التقرير</b><span>'+j.form+' — '+j.reportDate+'</span></div><div class="row"><b>الدين</b><span>'+usd(j.debt)+' — '+x(j.debtPct)+' '+mark(j.checks.debt)+'</span></div><div class="row"><b>ودائع بفائدة معلنة</b><span>'+x(j.depositsPct)+' '+mark(j.checks.deposits)+'</span></div><div class="row"><b>دخل فوائد/تمويل</b><span>'+x(j.interestPct)+' — '+(j.prohibitedSource||'')+' '+mark(j.checks.prohibited)+'</span></div><div class="row"><b>القيمة السوقية</b><span>'+(j.marketCap==null?'بيانات غير كافية':'<p class="small muted">'+(j.note||'لا توجد ملاحظة')+'</p></div>'}catch(e){out.innerHTML='<div class="card bad">'+e.message+'</div>'}}</script></html>`;
export default {async fetch(req){if(req.method==="OPTIONS")return new Response(null,{headers:CORS});const u=new URL(req.url);if(u.pathname==="/api/scan"){try{const s=(u.searchParams.get("symbol")||"").trim();if(!/^[A-Za-z.]{1,8}$/.test(s))return json({error:"أدخل رمز سهم صحيح"},400);return json(await scan(s));}catch(e){return json({error:e.message||"فشل الفحص"},500)}}return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8"}})}};+j.marketCap.toLocaleString())+'</span></div><div class="row"><b>السعر / الأسهم</b><span>'+(j.price==null?'بيانات غير كافية':'<p class="small muted">'+(j.note||'لا توجد ملاحظة')+'</p></div>'}catch(e){out.innerHTML='<div class="card bad">'+e.message+'</div>'}}</script></html>`;
export default {async fetch(req){if(req.method==="OPTIONS")return new Response(null,{headers:CORS});const u=new URL(req.url);if(u.pathname==="/api/scan"){try{const s=(u.searchParams.get("symbol")||"").trim();if(!/^[A-Za-z.]{1,8}$/.test(s))return json({error:"أدخل رمز سهم صحيح"},400);return json(await scan(s));}catch(e){return json({error:e.message||"فشل الفحص"},500)}}return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8"}})}};+j.price.toFixed(4))+' / '+(j.shares==null?'بيانات غير كافية':j.shares.toLocaleString())+'</span></div><p class="small muted">'+(j.note||'لا توجد ملاحظة')+'</p></div>'}catch(e){out.innerHTML='<div class="card bad">'+e.message+'</div>'}}</script></html>`;
export default {async fetch(req){if(req.method==="OPTIONS")return new Response(null,{headers:CORS});const u=new URL(req.url);if(u.pathname==="/api/scan"){try{const s=(u.searchParams.get("symbol")||"").trim();if(!/^[A-Za-z.]{1,8}$/.test(s))return json({error:"أدخل رمز سهم صحيح"},400);return json(await scan(s));}catch(e){return json({error:e.message||"فشل الفحص"},500)}}return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8"}})}};