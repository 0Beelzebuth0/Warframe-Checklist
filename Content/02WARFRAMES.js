/* Warframes module — data is generated and published by GitHub Actions. */
(function(){
"use strict";
const labels={neuroptics:"Neuroptics",chassis:"Chassis",systems:"Systems"};
const snapshot=window.WFC_WARFRAMES_SNAPSHOT||{items:[],updatedAt:null,source:"snapshot"};
function normalize(raw){
 const items=Array.isArray(raw.items)?raw.items:[];
 return items.filter(f=>f&&f.id&&f.name&&Array.isArray(f.parts)&&f.parts.length===3)
 .map(f=>({...f,parts:f.parts.map(p=>({...p,label:labels[p.id]||p.label||p.id,drops:Array.isArray(p.drops)?p.drops:[]}))}));
}
WFC.defineModule("02WARFRAMES",{
 kind:"warframes",title:{en:"Warframes",pt:"Warframes",es:"Warframes",fr:"Warframes",de:"Warframes",ru:"Варфреймы",ja:"ウォーフレーム",zh:"战甲",ko:"워프레임",it:"Warframe"},
 cover:{page:"Warframes",files:[]},items:normalize(snapshot),updatedAt:snapshot.updatedAt||null,source:snapshot.source||"GitHub Actions"
});
const mod=WFC.mods["02WARFRAMES"];
mod.status=mod.items.length?"ok":"unavailable";
})();
