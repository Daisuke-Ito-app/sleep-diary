
"use strict";

const DB_NAME = "cbtiSleepDiaryDB";
const DB_VERSION = 1;
const STORE_NAME = "appState";
const STATE_KEY = "current";
const SCHEMA_VERSION = 1;

let seq = 0;
let db = null;
let saveTimer = null;

function $(id){ return document.getElementById(id); }
function checkedValues(id){ return [...$(id).querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value); }
function toMin(t){ if(!t) return null; const [h,m]=t.split(":").map(Number); return h*60+m; }
function diffF(a,b){ if(a==null||b==null)return null; let d=b-a; if(d<0)d+=1440; return d; }
function fmt(v){ if(v==null||!isFinite(v))return "—"; const h=Math.floor(v/60),m=Math.round(v%60); return h?`${h}時間${m?m+"分":""}`:`${m}分`; }
function esc(s){ return String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function toast(t){ $("toast").textContent=t; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),1600); }

function isValidDate(v){ return typeof v==="string" && (/^\d{4}-\d{2}-\d{2}$/).test(v) && !Number.isNaN(Date.parse(v+"T00:00:00")); }
function isValidTime(v){ return typeof v==="string" && (/^(?:[01]\d|2[0-3]):[0-5]\d$/).test(v); }
function isNullableTime(v){ return v==="" || isValidTime(v); }
function isNullableDate(v){ return v==="" || isValidDate(v); }
function intOrNull(v,min,max){
  if(v===null || v==="") return null;
  if(typeof v!=="number" || !Number.isInteger(v) || v<min || v>max) throw new Error("数値形式エラー");
  return v;
}
function stringFromAllowed(v, allowed, fallback){
  return allowed.includes(v) ? v : fallback;
}
function sanitizeImportedData(d){
  if(!d || typeof d!=="object") throw new Error("形式不正");
  if(d.schemaVersion!==SCHEMA_VERSION) throw new Error("未対応のバックアップ形式");

  const safe = {
    schemaVersion: SCHEMA_VERSION,
    savedAt: typeof d.savedAt==="string" ? d.savedAt : new Date().toISOString(),
    age: "",
    work: "日勤",
    driving: "none",
    sleepiness: "none",
    flags: [],
    diary: []
  };

  if(d.age!=="" && d.age!==undefined){
    const n=Number(d.age);
    if(!Number.isInteger(n) || n<18 || n>110) throw new Error("年齢形式エラー");
    safe.age=String(n);
  }

  safe.work = stringFromAllowed(d.work, ["日勤","夜勤","交代勤務","不規則","無職・退職","その他"], "日勤");
  safe.driving = stringFromAllowed(d.driving, ["none","private","daily","work"], "none");
  safe.sleepiness = stringFromAllowed(d.sleepiness, ["none","mild","severe"], "none");

  const allowedFlags = ["転倒歴","てんかん","躁・軽躁疑い","OSAまたは疑い","夜間頻尿","睡眠薬2剤以上"];
  if(Array.isArray(d.flags)) safe.flags = d.flags.filter(x=>allowedFlags.includes(x));

  if(!Array.isArray(d.diary)) throw new Error("日誌形式エラー");
  if(d.diary.length>366) throw new Error("日誌件数が多すぎます");

  safe.diary = d.diary.map(r=>{
    if(!r || typeof r!=="object") throw new Error("日誌形式エラー");
    const row = {
      date: typeof r.date==="string" ? r.date : "",
      bed: typeof r.bed==="string" ? r.bed : "",
      lights: typeof r.lights==="string" ? r.lights : "",
      sol: r.sol===null || r.sol==="" || r.sol===undefined ? null : Number(r.sol),
      waso: r.waso===null || r.waso==="" || r.waso===undefined ? null : Number(r.waso),
      finalWake: typeof r.finalWake==="string" ? r.finalWake : "",
      out: typeof r.out==="string" ? r.out : "",
      nap: r.nap===null || r.nap==="" || r.nap===undefined ? null : Number(r.nap)
    };

    if(!isNullableDate(row.date)) throw new Error("日付形式エラー");
    for(const key of ["bed","lights","finalWake","out"]){
      if(!isNullableTime(row[key])) throw new Error("時刻形式エラー");
    }
    row.sol = intOrNull(row.sol,0,600);
    row.waso = intOrNull(row.waso,0,600);
    row.nap = intOrNull(row.nap,0,600);
    return row;
  });

  return safe;
}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=e=>{
      const idb=e.target.result;
      if(!idb.objectStoreNames.contains(STORE_NAME)) idb.createObjectStore(STORE_NAME);
    };
    req.onsuccess=e=>{
      db=e.target.result;
      $("storageBadge").textContent="PCやスマートフォンへの保存：利用可能";
      $("storageBadge").className="badge ok";
      resolve(db);
    };
    req.onerror=()=>{
      $("storageBadge").textContent="PCやスマートフォンへの保存：利用不可";
      $("storageBadge").className="badge warn";
      reject(req.error);
    };
  });
}
function idbPut(key,value){
  return new Promise((resolve,reject)=>{
    if(!db){ reject(new Error("DB未初期化")); return; }
    const tx=db.transaction(STORE_NAME,"readwrite");
    tx.objectStore(STORE_NAME).put(value,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
function idbGet(key){
  return new Promise((resolve,reject)=>{
    if(!db){ resolve(null); return; }
    const tx=db.transaction(STORE_NAME,"readonly");
    const req=tx.objectStore(STORE_NAME).get(key);
    req.onsuccess=()=>resolve(req.result ?? null);
    req.onerror=()=>reject(req.error);
  });
}
function idbDelete(key){
  return new Promise((resolve,reject)=>{
    if(!db){ resolve(); return; }
    const tx=db.transaction(STORE_NAME,"readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

function setInputValue(tr, field, value){
  const el=tr.querySelector(`[data-f="${field}"]`);
  el.value = value ?? "";
}

function addRow(d={}, silent=false){
  seq++;
  const tr=document.createElement("tr");
  tr.dataset.id=String(seq);

  const cells = [];
  function addInputCell(type, field, attrs={}){
    const td=document.createElement("td");
    const input=document.createElement("input");
    input.className="diary";
    input.type=type;
    input.dataset.f=field;
    for(const [k,v] of Object.entries(attrs)) input.setAttribute(k,String(v));
    td.appendChild(input);
    tr.appendChild(td);
    return input;
  }

  const dateInput=addInputCell("date","date");
  const bedInput=addInputCell("time","bed");
  const lightsInput=addInputCell("time","lights");
  const solInput=addInputCell("number","sol",{min:0,max:600,placeholder:"例 30"});
  const wasoInput=addInputCell("number","waso",{min:0,max:600,placeholder:"例 45"});
  const finalWakeInput=addInputCell("time","finalWake");
  const outInput=addInputCell("time","out");
  const napInput=addInputCell("number","nap",{min:0,max:600,placeholder:"例 30"});

  setInputValue(tr,"date",d.date||"");
  setInputValue(tr,"bed",d.bed||"");
  setInputValue(tr,"lights",d.lights||"");
  setInputValue(tr,"sol",d.sol??"");
  setInputValue(tr,"waso",d.waso??"");
  setInputValue(tr,"finalWake",d.finalWake||"");
  setInputValue(tr,"out",d.out||"");
  setInputValue(tr,"nap",d.nap??"");

  for(const outKey of ["tib","tst","se"]){
    const td=document.createElement("td");
    td.dataset.o=outKey;
    td.textContent="—";
    tr.appendChild(td);
  }

  const tdBtn=document.createElement("td");
  const btn=document.createElement("button");
  btn.type="button";
  btn.className="danger";
  btn.setAttribute("aria-label","この行を削除");
  btn.textContent="×";
  tdBtn.appendChild(btn);
  tr.appendChild(tdBtn);

  $("diaryTable").querySelector("tbody").appendChild(tr);

  btn.addEventListener("click",()=>{
    tr.remove();
    calculate();
    scheduleSave();
  });

  [dateInput,bedInput,lightsInput,solInput,wasoInput,finalWakeInput,outInput,napInput].forEach(el=>{
    el.addEventListener("input",scheduleSave);
    el.addEventListener("change",()=>{ calculate(); scheduleSave(); });
  });

  if(!silent) scheduleSave();
}

function addDays(n){
  let last=null;
  const trs=[...$("diaryTable").querySelectorAll("tbody tr")];
  if(trs.length){
    const v=trs[trs.length-1].querySelector('[data-f="date"]').value;
    if(v && isValidDate(v)) last=new Date(v+"T00:00:00");
  }
  for(let i=0;i<n;i++){
    let date="";
    if(last){
      last.setDate(last.getDate()+1);
      date=last.toISOString().slice(0,10);
    }
    addRow({date}, true);
  }
  scheduleSave();
}

function rawRow(tr){
  const v=f=>tr.querySelector(`[data-f="${f}"]`).value;
  const n=f=>v(f)===""?null:Number(v(f));
  return {date:v("date"),bed:v("bed"),lights:v("lights"),sol:n("sol"),waso:n("waso"),finalWake:v("finalWake"),out:v("out"),nap:n("nap")};
}

function calculate(){
  const valid=[],errors=[];
  [...$("diaryTable").querySelectorAll("tbody tr")].forEach((tr,i)=>{
    const r=rawRow(tr);
    const any=[r.bed,r.lights,r.finalWake,r.out,r.sol,r.waso].some(x=>x!==""&&x!==null);

    if(!any){
      tr.querySelector('[data-o="tib"]').textContent="—";
      tr.querySelector('[data-o="tst"]').textContent="—";
      tr.querySelector('[data-o="se"]').textContent="—";
      return;
    }

    if(!r.bed||!r.lights||!r.finalWake||!r.out||r.sol===null||r.waso===null){
      errors.push(`${i+1}行目：入力不足`);
      return;
    }
    if(!isValidTime(r.bed)||!isValidTime(r.lights)||!isValidTime(r.finalWake)||!isValidTime(r.out)){
      errors.push(`${i+1}行目：時刻形式エラー`);
      return;
    }
    if(!Number.isInteger(r.sol)||r.sol<0||r.sol>600||!Number.isInteger(r.waso)||r.waso<0||r.waso>600){
      errors.push(`${i+1}行目：分数入力エラー`);
      return;
    }

    const tib=diffF(toMin(r.bed),toMin(r.out));
    const pre=diffF(toMin(r.bed),toMin(r.lights));
    const terminal=diffF(toMin(r.finalWake),toMin(r.out));
    const tst=tib-pre-r.sol-r.waso-terminal;
    const se=tib>0?tst/tib*100:null;

    if(tib<=0||tib>1000||tst<0||se<0||se>100){
      errors.push(`${i+1}行目：入力内容に矛盾`);
      return;
    }

    Object.assign(r,{tib,tst,se,nap:r.nap??0});
    valid.push(r);
    tr.querySelector('[data-o="tib"]').textContent=fmt(tib);
    tr.querySelector('[data-o="tst"]').textContent=fmt(tst);
    tr.querySelector('[data-o="se"]').textContent=se.toFixed(1)+"%";
  });

  const avg=k=>valid.length?valid.reduce((s,r)=>s+r[k],0)/valid.length:null;
  $("daysOut").textContent=valid.length||"—";
  $("avgTIB").textContent=fmt(avg("tib"));
  $("avgTST").textContent=fmt(avg("tst"));
  $("avgSE").textContent=valid.length?avg("se").toFixed(1)+"%":"—";
  $("avgSOL").textContent=valid.length?Math.round(avg("sol"))+"分":"—";
  $("avgWASO").textContent=valid.length?Math.round(avg("waso"))+"分":"—";
  $("err").classList.toggle("hidden",!errors.length);
  $("err").textContent=errors.join(" / ");
  return valid;
}

function collect(){
  return {
    schemaVersion:SCHEMA_VERSION,
    savedAt:new Date().toISOString(),
    age:$("age").value,
    work:$("work").value,
    driving:$("driving").value,
    sleepiness:$("sleepiness").value,
    flags:checkedValues("flags"),
    diary:[...$("diaryTable").querySelectorAll("tbody tr")].map(rawRow)
  };
}

async function saveState(showToast=false){
  try{
    await idbPut(STATE_KEY,collect());
    $("storageBadge").textContent="PCやスマートフォンへの保存：保存済み";
    $("storageBadge").className="badge ok";
    if(showToast) toast("PCやスマートフォン内に保存しました");
  }catch(e){
    $("storageBadge").textContent="PCやスマートフォンへの保存：エラー";
    $("storageBadge").className="badge warn";
    console.error(e);
  }
}
function scheduleSave(){
  clearTimeout(saveTimer);
  $("storageBadge").textContent="PCやスマートフォンへの保存：保存中…";
  $("storageBadge").className="badge";
  saveTimer=setTimeout(()=>saveState(false),400);
}

function applyState(d){
  $("age").value=d.age||"";
  $("work").value=d.work||"日勤";
  $("driving").value=d.driving||"none";
  $("sleepiness").value=d.sleepiness||"none";
  $("flags").querySelectorAll("input").forEach(x=>x.checked=(d.flags||[]).includes(x.value));

  $("diaryTable").querySelector("tbody").innerHTML="";
  seq=0;
  (d.diary||[]).forEach(row=>addRow(row,true));
  if(!(d.diary||[]).length) addDays(7);
  calculate();
}

async function restoreState(){
  const d=await idbGet(STATE_KEY);
  if(!d) return false;
  const safe=sanitizeImportedData(d);
  applyState(safe);
  return true;
}

function makePaper(){
  const rows=calculate();
  const drive={none:"なし",private:"時々",daily:"日常的",work:"業務運転"}[$("driving").value];
  const sleepy={none:"特になし",mild:"少しある",severe:"強くある"}[$("sleepiness").value];
  const flags=checkedValues("flags");
  const container=$("paperText");
  container.replaceChildren();

  const line1=document.createElement("div");
  line1.className="paperline";
  line1.textContent=`年齢：${$("age").value||"　"}歳　勤務：${$("work").value}　運転：${drive}　日中眠気：${sleepy}`;
  container.appendChild(line1);

  const line2=document.createElement("div");
  line2.className="paperline";
  line2.textContent=`安全のための確認：${flags.length?flags.join("、"):"特になし"}`;
  container.appendChild(line2);

  if(rows.length){
    const avg=k=>rows.reduce((s,r)=>s+r[k],0)/rows.length;
    const line3=document.createElement("div");
    line3.className="paperline";
    line3.textContent=`計算に使えた日数：${rows.length}日　平均 寝床にいた時間：${fmt(avg("tib"))}　平均 推定睡眠時間：${fmt(avg("tst"))}　平均 睡眠効率：${avg("se").toFixed(1)}%`;
    container.appendChild(line3);

    const line4=document.createElement("div");
    line4.className="paperline";
    line4.textContent=`平均 寝つくまで：${Math.round(avg("sol"))}分　平均 夜中に起きていた時間：${Math.round(avg("waso"))}分`;
    container.appendChild(line4);

    const wrap=document.createElement("div");
    wrap.className="tablewrap";
    const table=document.createElement("table");
    const thead=document.createElement("thead");
    const trh=document.createElement("tr");
    ["起きた朝の日付","寝床へ入った時刻","眠ろうとした時刻","寝つくまで","夜中に起きていた時間","最後に目が覚めた時刻","寝床から出た時刻","昼寝・うたた寝"].forEach(t=>{
      const th=document.createElement("th"); th.textContent=t; trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody=document.createElement("tbody");
    rows.forEach(r=>{
      const tr=document.createElement("tr");
      [r.date||"",r.bed,r.lights,`${r.sol}分`,`${r.waso}分`,r.finalWake,r.out,`${r.nap||0}分`].forEach(v=>{
        const td=document.createElement("td"); td.textContent=String(v); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }else{
    const line=document.createElement("div");
    line.className="paperline";
    line.textContent="睡眠日誌：有効な記録なし";
    container.appendChild(line);
  }
}

function exportBackup(){
  const data=collect();
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const d=new Date().toISOString().slice(0,10);
  a.href=url;
  a.download=`sleep-diary-backup-${d}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function importBackup(file){
  if(!file || file.size>2*1024*1024){
    alert("バックアップファイルが大きすぎるか、選択されていません。");
    return;
  }
  const reader=new FileReader();
  reader.onload=async ()=>{
    try{
      const raw=JSON.parse(String(reader.result));
      const safe=sanitizeImportedData(raw);
      applyState(safe);
      await saveState(false);
      toast("バックアップを読み込みました");
    }catch(e){
      console.error(e);
      alert("バックアップファイルを読み込めません。形式を確認してください。");
    }finally{
      $("importFile").value="";
    }
  };
  reader.readAsText(file);
}

["age","work","driving","sleepiness"].forEach(id=>{
  $(id).addEventListener("input",scheduleSave);
  $(id).addEventListener("change",scheduleSave);
});
$("flags").addEventListener("change",scheduleSave);
$("add1").addEventListener("click",()=>addDays(1));
$("add7").addEventListener("click",()=>addDays(7));
$("calc").addEventListener("click",()=>{calculate();scheduleSave();});
$("makePaper").addEventListener("click",makePaper);
$("exportData").addEventListener("click",exportBackup);
$("importData").addEventListener("click",()=>$("importFile").click());
$("importFile").addEventListener("change",()=>{const f=$("importFile").files?.[0];if(f)importBackup(f);});

$("deleteSaved").addEventListener("click",async ()=>{
  if(confirm("このPCやスマートフォンに保存されている睡眠記録をすべて削除しますか？この操作は元に戻せません。")){
    await idbDelete(STATE_KEY);
    $("age").value="";
    $("work").value="日勤";
    $("driving").value="none";
    $("sleepiness").value="none";
    $("flags").querySelectorAll("input").forEach(x=>x.checked=false);
    $("diaryTable").querySelector("tbody").innerHTML="";
    seq=0;
    addDays(7);
    calculate();
    await saveState(false);
    toast("PCやスマートフォン内の記録を削除しました");
  }
});

function updateOnlineBadge(){
  const b=$("offlineBadge");
  if(navigator.onLine){
    b.textContent="オンライン";
    b.className="badge ok";
  }else{
    b.textContent="オフライン";
    b.className="badge warn";
  }
}
window.addEventListener("online",updateOnlineBadge);
window.addEventListener("offline",updateOnlineBadge);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./service-worker.js").catch(err=>console.error("Service Worker登録失敗",err));
  });
}

(async function init(){
  updateOnlineBadge();
  try{
    await openDB();
    const restored=await restoreState();
    if(!restored){
      addDays(7);
      await saveState(false);
    }
    calculate();
  }catch(e){
    console.error(e);
    if(!$("diaryTable").querySelector("tbody tr")) addDays(7);
    calculate();
  }
})();
