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
  let last=null;
  for(let attempt=0; attempt<3; attempt++){
    try{
      const r=await fetch(url, {
        headers: {
          "User-Agent": SEC_UA,
          "Accept":"application/json,text/html;q=0.9,*/*;q=0.8",
          "Accept-Language":"en-US,en;q=0.9"
        }
      });
      if(r.ok) return r;
      last=r;
      if(r.status!==403 && r.status!==429 && r.status<500) return r;
    }catch(e){ last=null; }
    await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));
  }
  return last || new Response("SEC request failed",{status:503});
}

function filingFromFacts(facts){
  const seen=new Map();
  const financialNeedles=[
    "Revenue","SalesRevenue","CashAndCashEquivalents","Assets","Liabilities",
    "LongTermDebt","Debt","InterestIncome","IncomeLoss","StockholdersEquity",
    "AccountsReceivable","Inventory","MarketableSecurities","Investments"
  ];
  for(const [taxonomy,taxonomyFacts] of Object.entries(facts||{})){
    for(const [tag,fact] of Object.entries(taxonomyFacts||{})){
      for(const units of Object.values(fact?.units||{})){
        for(const x of units||[]){
          const form=x.form;
          if(!["10-Q","10-Q/A","10-K","10-K/A","20-F","20-F/A","40-F","40-F/A","6-K"].includes(form)) continue;
          if(!x.accn || !x.filed || !x.end) continue;
          // A 6-K is useful here only when its XBRL actually contains
          // financial-statement facts; this avoids selecting a later 6-K
          // that only reports a financing or corporate event.
          if(form==="6-K" && !financialNeedles.some(n=>String(tag).includes(n))) continue;
          const key=x.accn;
          if(!seen.has(key)){
            seen.set(key,{form,accn:x.accn,filingDate:x.filed,reportDate:x.end,doc:null});
          }else{
            const old=seen.get(key);
            if(x.filed>old.filingDate) old.filingDate=x.filed;
            if(x.end>old.reportDate) old.reportDate=x.end;
          }
        }
      }
    }
  }
  const arr=[...seen.values()].sort((a,b)=>{
    const fd=String(b.filingDate).localeCompare(String(a.filingDate));
    if(fd!==0) return fd;
    return String(b.reportDate).localeCompare(String(a.reportDate));
  });
  return arr[0]||null;
}

async function archivePrimaryDocument(cik,accn,form){
  const base="https://www.sec.gov/Archives/edgar/data/"+Number(cik)+"/"+accn.replace(/-/g,"")+"/";
  try{
    const r=await sec(base+"index.json");
    if(r.ok){
      const j=await r.json();
      const items=Array.isArray(j?.directory?.item)?j.directory.item:[];
      const candidates=items
        .map(x=>x.name)
        .filter(Boolean)
        .filter(n=>/\.htm$/i.test(n))
        .filter(n=>!/-index\.htm$/i.test(n))
        .filter(n=>!/^ex\d/i.test(n))
        .filter(n=>!/^ixviewer/i.test(n));
      const preferred=form==="10-K"
        ? candidates.find(n=>/10-k/i.test(n))
        : candidates.find(n=>/10-q/i.test(n));
      return base+(preferred||candidates[0]||"");
    }
  }catch{}
  return "";
}


async function filingHtmlDocuments(cik,accn,form,primaryUrl){
  const base="https://www.sec.gov/Archives/edgar/data/"+Number(cik)+"/"+accn.replace(/-/g,"")+"/";
  const urls=[];
  if(primaryUrl) urls.push(primaryUrl);
  try{
    const r=await sec(base+"index.json");
    if(r.ok){
      const j=await r.json();
      const items=Array.isArray(j?.directory?.item)?j.directory.item:[];
      const names=items.map(x=>x?.name).filter(Boolean)
        .filter(n=>/\.htm$/i.test(n))
        .filter(n=>!/-index\.htm$/i.test(n))
        .filter(n=>!/^ixviewer/i.test(n));
      // Foreign private issuers often place the financial statements in
      // EX-99.1/EX-99.2 rather than inside the 6-K cover document.
      for(const n of names){
        if(n===primaryUrl.split("/").pop()) continue;
        if(/ex99/i.test(n) || /financial|statement|20f|40f|10q|10k/i.test(n)) urls.push(base+n);
      }
    }
  }catch{}
  const unique=[...new Set(urls)].slice(0,8);
  const parts=[];
  for(const u of unique){
    try{
      const r=await sec(u);
      if(r.ok) parts.push(await r.text());
    }catch{}
  }
  return parts.join("\n");
}

async function getCik(symbol){
  const requested = upper(symbol);
  const aliases = {MBTO:"MBOT"};
  const target = aliases[requested] || requested;
  const normalizedTarget = target.replace(/[-.]/g,"");

  // SEC publishes three useful ticker/CIK maps. ticker.txt is the broad
  // ticker-to-CIK map used by EDGAR search; the exchange JSON has a
  // different array-based shape; company_tickers.json is the legacy object map.
  const tickerTxt=await sec("https://www.sec.gov/include/ticker.txt");
  if(tickerTxt.ok){
    const text=await tickerTxt.text();
    for(const line of text.split(/\r?\n/)){
      const parts=line.trim().split(/\s+/);
      if(parts.length<2) continue;
      const ticker=upper(parts[0]);
      if(ticker===target || ticker.replace(/[-.]/g,"")===normalizedTarget){
        return {
          cik:String(parts[1]).padStart(10,"0"),
          ticker:target,
          name:target
        };
      }
    }
  }

  const exchangeR=await sec("https://www.sec.gov/files/company_tickers_exchange.json");
  if(exchangeR.ok){
    const j=await exchangeR.json();
    const fields=Array.isArray(j?.fields)?j.fields:[];
    const rows=Array.isArray(j?.data)?j.data:[];
    const tickerIndex=fields.indexOf("ticker");
    const cikIndex=fields.indexOf("cik");
    const nameIndex=fields.indexOf("name");
    if(tickerIndex>=0 && cikIndex>=0){
      for(const row of rows){
        const ticker=upper(row?.[tickerIndex]);
        if(ticker===target || ticker.replace(/[-.]/g,"")===normalizedTarget){
          return {
            cik:String(row[cikIndex]).padStart(10,"0"),
            ticker:target,
            name:row?.[nameIndex] || target
          };
        }
      }
    }
  }

  const r=await sec("https://www.sec.gov/files/company_tickers.json");
  if(r.ok){
    const j=await r.json();
    for(const x of Object.values(j||{})){
      const ticker=upper(x?.ticker);
      if(ticker===target || ticker.replace(/[-.]/g,"")===normalizedTarget){
        const cik=x?.cik_str ?? x?.cik;
        if(cik==null) continue;
        return {
          cik:String(cik).padStart(10,"0"),
          ticker:target,
          name:x?.title || x?.name || target
        };
      }
    }
  }

  // Final SEC fallback: use EDGAR's company-search endpoint, which accepts
  // a company name, ticker symbol, or CIK in its search interface.
  try{
    const searchUrl="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&output=xml&CIK="+encodeURIComponent(target);
    const sr=await sec(searchUrl);
    if(sr.ok){
      const xml=await sr.text();
      const m=xml.match(/<CIK>\s*(\d+)\s*<\/CIK>/i);
      if(m){
        const n=xml.match(/<CONFORMED-NAME>\s*([^<]+)\s*<\/CONFORMED-NAME>/i);
        return {
          cik:String(m[1]).padStart(10,"0"),
          ticker:target,
          name:clean(n?.[1]||target)
        };
      }
    }
  }catch{}

  throw Error("السهم غير موجود في خرائط SEC الحالية");
}

function chooseFiling(recent){
  let best=null;
  for(let i=0;i<(recent.form||[]).length;i++){
    const form=recent.form[i];
    if(form!=="10-Q" && form!=="10-Q/A" && form!=="10-K" && form!=="10-K/A") continue;
    const candidate={
      form,
      accn:recent.accessionNumber[i],
      filingDate:recent.filingDate[i],
      reportDate:recent.reportDate[i],
      doc:recent.primaryDocument[i]
    };
    if(!best || String(candidate.filingDate||"")>String(best.filingDate||"")) best=candidate;
  }
  return best;
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

let tableScale = 1;

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
      if(n!==null) return n * (tableScale || 1);
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
  const current=instantFact(facts,currentTags,accn,end)?.value;
  const noncurrent=instantFact(facts,noncurrentTags,accn,end)?.value;
  if(current!=null && noncurrent!=null) return current+noncurrent;

  const totalTags=[
    "LongTermDebtAndFinanceLeaseObligations",
    "LongTermDebt",
    "ConvertibleNotesPayable",
    "NotesPayable"
  ];
  for(const tag of totalTags){
    const x=instantFact(facts,[tag],accn,end);
    if(x?.value!=null) return x.value;
  }
  return null;
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

async function scanWithFiling(found,sub,filing,facts){
  const filingUrl=filing.doc || ("https://www.sec.gov/Archives/edgar/data/"+Number(found.cik)+"/"+filing.accn.replace(/-/g,"")+"/");
  const html=await filingHtmlDocuments(found.cik,filing.accn,filing.form,filingUrl);
  const rows=tableRows(html);
  const localTableScale = /U\.S\. dollars in thousands/i.test(clean(html)) ? 1000 : 1;
  tableScale = localTableScale;
  const targetDays=filing.form.startsWith("10-K")||filing.form.startsWith("20-F")||filing.form.startsWith("40-F")?365:(filing.form==="6-K"?180:91);
  const end=filing.reportDate;
  let shares=instantFact(facts,["EntityCommonStockSharesOutstanding"],filing.accn)?.value;
  if(shares==null){
    const text=clean(html);
    const m=text.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s+shares of common stock/i)
      || text.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s+shares issued and outstanding/i);
    if(m) shares=num(m[1]);
  }
  const rev=durationFact(facts,["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","SalesRevenueGoodsNet"],filing.accn,end,filing.form,targetDays);
  const revenue=rev?.value ?? rowNumber(rows,[/^revenues?$/i,/^sales$/i,/^net sales$/i]) ?? null;
  const interest=durationFact(facts,["InterestIncomeNonoperating","InterestIncome","InvestmentIncomeInterest"],filing.accn,end,filing.form,targetDays);
  const interestIncome=interest?.value ?? rowNumber(rows,[/^interest income(?:, net)?$/i,/^interest income$/i]) ?? null;
  const financingIncome=rowNumber(rows,[/^financing income(?:, net)?$/i,/^financing income$/i]);
  const interestCombined=rowNumber(rows,[/^interest income and unrealized gains from marketable securities$/i]);
  let debt=debtFromFacts(facts,filing.accn,end);
  if(debt==null) debt=rowNumber(rows,[/interest[- ]bearing debt/i,/short[- ]term debt/i,/long[- ]term debt/i,/convertible notes? payable/i,/convertible debt/i,/notes? payable/i,/borrowings?/i]);
  if(debt==null){
    const debtCurrent=rowNumber(rows,[/^debt\s*[–—-]\s*current$/i]);
    const debtNoncurrent=rowNumber(rows,[/^debt\s*[–—-]\s*non-current$/i]);
    debt=sumUnique([debtCurrent,debtNoncurrent]);
  }
  if(debt==null) debt=0;
  const cash=instantFact(facts,["CashAndCashEquivalentsAtCarryingValue"],filing.accn,end)?.value ?? rowNumber(rows,[/^cash and cash equivalents$/i]);
  const deposits=rowNumber(rows,[/interest[- ]bearing deposits?/i,/interest[- ]bearing deposit accounts?/i]);
  const moneyMarket=rowNumber(rows,[/money market mutual funds?/i,/money market funds?/i]);
  const shortTermInvestments=rowNumber(rows,[/^short[- ]term investments$/i]);
  const interestBearingInvestments=rowNumber(rows,[/interest[- ]bearing securities/i,/interest[- ]bearing investments?/i,/treasury bills?/i,/government securities/i,/certificates? of deposit/i,/commercial paper/i,/corporate bonds?/i]);
  const liquidityFact=instantFact(facts,["MarketableSecuritiesCurrent"],filing.accn,end)?.value;
  const marketableSecurities=liquidityFact ?? shortTermInvestments ?? moneyMarket ?? interestBearingInvestments;
  const liquidityAssets=deposits;
  const liquidityKnown=deposits!=null;
  const price=await marketPrice(found.ticker);
  const marketCap=price!=null && shares!=null ? price*shares : null;
  const debtPct=pct(debt,marketCap);
  const depositsPct=liquidityKnown ? pct(liquidityAssets,marketCap) : null;
  const prohibitedPct=pct(interestIncome,revenue);
  const financingPct=pct(financingIncome,revenue);
  const checks={debt:debtPct==null?null:debtPct<=LIMITS.debt,deposits:depositsPct==null?null:depositsPct<=LIMITS.deposits,prohibited:prohibitedPct==null?null:prohibitedPct<=LIMITS.prohibited};
  const known=Object.values(checks).filter(v=>v!==null);
  return {
    symbol:found.ticker,requestedSymbol:upper(filing.requestedSymbol||found.ticker),company:sub?.name||found.name,
    form:filing.form,filingDate:filing.filingDate,reportDate:filing.reportDate,accession:filing.accn,filingUrl,
    price,shares,marketCap,revenue,debt,debtPct,deposits:liquidityAssets,depositsPct,cash,marketableSecurities:marketableSecurities ?? moneyMarket,
    liquidityAssets,liquidityAssetsPct:depositsPct,interestIncome,prohibitedPct,financingIncome,financingPct,checks,
    overall:known.length===3?known.every(Boolean):null,limits:LIMITS,interestCombined,periodDays:rev?.days ?? interest?.days ?? null,
    source:"SEC EDGAR + Yahoo Finance",
    note:interestIncome==null?(financingIncome!=null?"لم يظهر رقم مستقل لدخل الفوائد؛ دخل التمويل المعروض مؤشر بديل ولا يُستخدم للحكم النهائي على بند الدخل المحرم.":"لم يظهر رقم مستقل واضح لدخل الفوائد في الإفصاح."):"نسبة الدخل المحرم محسوبة من دخل الفوائد المستقل ÷ الإيرادات."
  };
}

async function scan(input){
  const found=await getCik(input);
  // Cloudflare can intermittently fail data.sec.gov while www.sec.gov remains reachable.
  // Try the official submissions endpoint on both SEC hosts before failing.
  let subR=await sec("https://data.sec.gov/submissions/CIK"+found.cik+".json");
  if(!subR.ok){
    subR=await sec("https://www.sec.gov/submissions/CIK"+found.cik+".json");
  }
  if(!subR.ok){
    // Last fallback: derive the latest filing from companyfacts when submissions is unavailable.
    const fallbackFacts=await sec("https://data.sec.gov/api/xbrl/companyfacts/CIK"+found.cik+".json");
    if(fallbackFacts.ok){
      const fallbackJson=await fallbackFacts.json();
      const fallbackFiling=filingFromFacts(fallbackJson?.facts||{});
      if(fallbackFiling){
        const fallbackDoc=await archivePrimaryDocument(found.cik,fallbackFiling.accn,fallbackFiling.form);
        const sub={name:found.name,filings:{recent:{}}};
        const filing={
          form:fallbackFiling.form,
          accn:fallbackFiling.accn,
          filingDate:fallbackFiling.filingDate,
          reportDate:fallbackFiling.reportDate,
          doc:fallbackDoc
        };
        return await scanWithFiling(found,sub,filing,fallbackJson.facts||{});
      }
    }
    throw Error("تعذر قراءة إفصاحات الشركة");
  }
  const sub=await subR.json();
  let filing=chooseFiling(sub.filings?.recent||{});

  // Foreign private issuers such as NTCL and PN commonly publish interim
  // financial statements through Form 6-K exhibits instead of 10-Q.
  // If no periodic 10-Q/10-K/20-F filing exists, use the latest SEC XBRL
  // filing that actually carries financial facts (including 6-K).
  const cfR=await sec("https://data.sec.gov/api/xbrl/companyfacts/CIK"+found.cik+".json");
  if(!cfR.ok) throw Error("تعذر قراءة بيانات XBRL");
  const facts=(await cfR.json()).facts||{};

  {
    const factFiling=filingFromFacts(facts);
    // For foreign private issuers, the latest financial filing is often a
    // 6-K while the latest 20-F is annual and can be much older.
    // Prefer a newer financial 6-K/20-F found in XBRL over a stale annual form.
    if(factFiling && (!filing || String(factFiling.filingDate||"")>String(filing.filingDate||""))){
      const factDoc=await archivePrimaryDocument(found.cik,factFiling.accn,factFiling.form);
      filing={
        form:factFiling.form,
        accn:factFiling.accn,
        filingDate:factFiling.filingDate,
        reportDate:factFiling.reportDate,
        doc:factDoc
      };
    }
  }
  if(!filing) throw Error("لا يوجد إفصاح مالي حديث يمكن قراءته");

  const filingUrl=filing.doc || ("https://www.sec.gov/Archives/edgar/data/"+Number(found.cik)+"/"+filing.accn.replace(/-/g,"")+"/");
  const html=await filingHtmlDocuments(found.cik,filing.accn,filing.form,filingUrl);
  const rows=tableRows(html);
  // SEC financial tables for MBOT are reported in thousands of U.S. dollars.
  // Keep XBRL values as-is; scale only values extracted from HTML tables.
  const localTableScale = /U\.S\. dollars in thousands/i.test(clean(html)) ? 1000 : 1;
  tableScale = localTableScale;

  const targetDays=filing.form.startsWith("10-K")?365:91;
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
  const interestCombined=rowNumber(rows,[
    /^interest income and unrealized gains from marketable securities$/i
  ]);

  let debt=debtFromFacts(facts,filing.accn,end);
  if(debt==null){
    debt=rowNumber(rows,[
      /interest[- ]bearing debt/i,
      /short[- ]term debt/i,
      /long[- ]term debt/i,
      /convertible notes? payable/i,
      /convertible debt/i,
      /notes? payable/i,
      /borrowings?/i
    ]);
  }
  if(debt==null){
    const debtCurrent=rowNumber(rows,[/^debt\s*[–—-]\s*current$/i]);
    const debtNoncurrent=rowNumber(rows,[/^debt\s*[–—-]\s*non-current$/i]);
    debt=sumUnique([debtCurrent,debtNoncurrent]);
  }
  // Lease liabilities are operating-lease obligations and are not used as the
  // interest-bearing debt numerator by this screen.
  if(debt==null) debt=0;

  // AAOIFI 21: the 30% liquidity condition concerns interest-taking deposits.
  // Do not substitute marketable securities, money-market funds, or ordinary investments for deposits.
  const deposits=rowNumber(rows,[
    /interest[- ]bearing deposits?/i,
    /interest[- ]bearing deposit accounts?/i
  ]);

  const cash=instantFact(facts,[
    "CashAndCashEquivalentsAtCarryingValue"
  ],filing.accn,end)?.value
    ?? rowNumber(rows,[/^cash and cash equivalents$/i]);

  const moneyMarket=rowNumber(rows,[
    /money market mutual funds?/i,
    /money market funds?/i
  ]);

  const interestBearingInvestments=rowNumber(rows,[
    /interest[- ]bearing securities/i,
    /interest[- ]bearing investments?/i,
    /treasury bills?/i,
    /government securities/i,
    /certificates? of deposit/i,
    /commercial paper/i,
    /corporate bonds?/i
  ]);

  const shortTermInvestments=rowNumber(rows,[/^short[- ]term investments$/i]);
  const liquidityFact=instantFact(facts,["MarketableSecuritiesCurrent"],filing.accn,end)?.value;
  const marketableSecurities=liquidityFact ?? shortTermInvestments ?? moneyMarket ?? interestBearingInvestments;
  const liquidityAssets=deposits;
  const liquidityKnown=deposits!=null;

  const price=await marketPrice(found.ticker);
  const marketCap=price!=null && shares!=null ? price*shares : null;

  const debtPct=pct(debt,marketCap);
  const depositsPct=liquidityKnown ? pct(liquidityAssets,marketCap) : null;
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
    company:sub?.name||found.name,
    form:filing.form,
    filingDate:filing.filingDate,
    reportDate:filing.reportDate,
    accession:filing.accn,
    filingUrl,
    price,shares,marketCap,
    revenue,
    debt,debtPct,
    deposits,depositsPct,
    cash,marketableSecurities:moneyMarket,
    liquidityAssets,liquidityAssetsPct:depositsPct,
    interestIncome,prohibitedPct,
    financingIncome,financingPct,
    checks,
    overall,
    limits:LIMITS,
    interestCombined,
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
      '<div class="row"><span class="label">الدين بفائدة</span><span class="value">'+money(x.debt)+' — '+percent(x.debtPct)+' '+status(x.checks.debt)+'</span></div>'+
      '<div class="row"><span class="label">ودائع بفائدة</span><span class="value">'+money(x.liquidityAssets)+' — '+percent(x.liquidityAssetsPct)+' '+status(x.checks.deposits)+'</span></div>'+
      '<div class="row"><span class="label">النقد</span><span class="value">'+money(x.cash)+'</span></div>'+
      '<div class="row"><span class="label">استثمارات سوق نقدية معلنة</span><span class="value">'+money(x.marketableSecurities)+'</span></div>'+
      '<div class="row"><span class="label">الإيرادات</span><span class="value">'+money(x.revenue)+'</span></div>'+
      '<div class="row"><span class="label">دخل فوائد مستقل</span><span class="value">'+money(x.interestIncome)+' — '+percent(x.prohibitedPct)+' '+status(x.checks.prohibited)+'</span></div>'+
      '<div class="row"><span class="label">دخل فوائد + مكاسب غير محققة (مجمّع)</span><span class="value">'+money(x.interestCombined)+'</span></div>'+
      '<div class="row"><span class="label">دخل التمويل (مؤشر)</span><span class="value">'+money(x.financingIncome)+' — '+percent(x.financingPct)+'</span></div>'+
      '<p class="note">'+esc(x.note)+'</p>'+
      '<p class="small">الحدود المستخدمة: الدين '+x.limits.debt+'%، الودائع بفائدة '+x.limits.deposits+'%، الدخل المحرم '+x.limits.prohibited+'%. النقد والأوراق/الاستثمارات السوقية لا تُستبدل ببند الودائع في هذه النسبة. هذه أداة فحص وليست فتوى.</p>'+
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
        if(!/^[A-Za-z][A-Za-z0-9.-]{0,11}$/.test(symbol)) return json({error:"أدخل رمز سهم صحيح"},400);
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
