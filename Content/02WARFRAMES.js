/* Warframes module — live data comes from the Netlify function; snapshot is fallback. */
(function(){
"use strict";
const labels={neuroptics:"Neuroptics",chassis:"Chassis",systems:"Systems"};
const CACHE_KEY="wfc.warframes.cache.v1", CACHE_TTL=60*60*1000;
const fallback=window.WFC_WARFRAMES_SNAPSHOT||{items:[],updatedAt:null,source:"snapshot"};
let cached=null;
try{cached=JSON.parse(localStorage.getItem(CACHE_KEY)||"null");}catch(e){}
const initial=(cached&&cached.data&&Array.isArray(cached.data.items))?cached.data:fallback;
function normalize(raw){
 const items=Array.isArray(raw.items)?raw.items:[];
 return items.filter(f=>f&&f.id&&f.name&&Array.isArray(f.parts)&&f.parts.length===3)
 .map(f=>({...f,parts:f.parts.map(p=>({...p,label:labels[p.id]||p.label||p.id,drops:Array.isArray(p.drops)?p.drops:[]}))}));
}
WFC.defineModule("02WARFRAMES",{
 kind:"warframes",title:{en:"Warframes",pt:"Warframes",es:"Warframes",fr:"Warframes",de:"Warframes",ru:"Варфреймы",ja:"ウォーフレーム",zh:"战甲",ko:"워프레임",it:"Warframe"},
 cover:{page:"Warframes",files:[]},items:normalize(initial),updatedAt:initial.updatedAt||null
});
const mod=WFC.mods["02WARFRAMES"];
function status(message){mod.status=message; if(WFC.refresh)WFC.refresh();}
async function update(){
 if(cached&&cached.savedAt&&Date.now()-cached.savedAt<CACHE_TTL){mod.status="cached";return;}
 try{
  const response=await fetch("/.netlify/functions/warframes",{headers:{"Accept":"application/json"}});
  if(!response.ok)throw new Error("HTTP "+response.status);
  const data=await response.json();
  const items=normalize(data);
  if(!items.length)throw new Error("A fonte retornou uma lista vazia ou incompatível.");
  const old=mod.items, seen=new Set(items.map(x=>x.id));
  // Nunca descarta uma entrada já existente; mantém como pendente se a API deixar de listá-la.
  old.forEach(f=>{if(!seen.has(f.id))items.push(f);});
  mod.items=items;mod.updatedAt=data.updatedAt||new Date().toISOString();mod.source=data.source||"WFCD";
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),data:{items:mod.items,updatedAt:mod.updatedAt,source:mod.source}}));}catch(e){}
  mod.items.forEach(f=>{f.key="02WARFRAMES|"+f.id;});
  status("ok"); if(WFC.refresh)WFC.refresh();
 }catch(error){
  mod.status=mod.items.length?"fallback":"unavailable"; if(WFC.refresh)WFC.refresh();
  console.warn("Warframe data update failed; keeping last known data.",error);
 }
}
update();
setInterval(()=>{cached=null;update();},CACHE_TTL);
})();