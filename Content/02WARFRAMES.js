/* Warframes module — live data comes from the Netlify function; snapshot is fallback. */
(function(){
"use strict";
const labels={neuroptics:"Neuroptics",chassis:"Chassis",systems:"Systems"};
const fallback=window.WFC_WARFRAMES_SNAPSHOT||{items:[],updatedAt:null,source:"snapshot"};
function normalize(raw){
 const items=Array.isArray(raw.items)?raw.items:[];
 return items.filter(f=>f&&f.id&&f.name&&Array.isArray(f.parts)&&f.parts.length===3)
 .map(f=>({...f,parts:f.parts.map(p=>({...p,label:labels[p.id]||p.label||p.id,drops:Array.isArray(p.drops)?p.drops:[]}))}));
}
WFC.defineModule("02WARFRAMES",{
 kind:"warframes",title:{en:"Warframes",pt:"Warframes",es:"Warframes",fr:"Warframes",de:"Warframes",ru:"Варфреймы",ja:"ウォーフレーム",zh:"战甲",ko:"워프레임",it:"Warframe"},
 cover:{page:"Warframes",files:[]},items:normalize(fallback),updatedAt:fallback.updatedAt||null
});
const mod=WFC.mods["02WARFRAMES"];
function status(message){mod.status=message; if(WFC.refresh)WFC.refresh();}
async function update(){
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
  mod.items.forEach(f=>{f.key="02WARFRAMES|"+f.id;});
  status("ok"); if(WFC.refresh)WFC.refresh();
 }catch(error){
  mod.status="fallback"; if(WFC.refresh)WFC.refresh();
  console.warn("Warframe data update failed; keeping last known data.",error);
 }
}
update();
})();