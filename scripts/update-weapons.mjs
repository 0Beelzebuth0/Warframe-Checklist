import fs from "node:fs/promises";
import path from "node:path";

const BASE="https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/";
const CATEGORIES=[["Primary","primary"],["Secondary","secondary"],["Melee","melee"]];
const DROPS_URL="https://raw.githubusercontent.com/WFCD/warframe-drop-data/main/data/all.json";
const COMPONENTS_URL=BASE+"Components.json";
const EXCLUDED=/^(?:Excalibur Prime)$/i;

async function fetchJson(url){
 const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"Warframe-Checklist-GitHub-Actions"},signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw new Error("HTTP "+r.status+" ao consultar "+url);
 return r.json();
}
const wikiPage=n=>"https://wiki.warframe.com/w/"+encodeURIComponent(String(n||"").trim().replace(/\s+/g,"_"));
function chanceNumber(v){if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=100?n:null;}
function pageUrl(title){return wikiPage(title);}

function buildDropIndex(data){
 const index=new Map();
 const add=(itemName,source,chance,detail="")=>{
  const n=chanceNumber(chance),label=String(source||"Fonte não identificada");
  const key=[label,n,detail].join("|");
  const rows=index.get(itemName)||[];
  if(!rows.some(x=>x.key===key))rows.push({key,source:label,chance:n,detail:String(detail||""),sourceUrl:pageUrl(label.split(" · ").pop())});
  index.set(itemName,rows);
 };
 for(const entry of data.blueprintLocations||[]){
  for(const enemy of entry.enemies||[]){
   const table=chanceNumber(enemy.chance),roll=chanceNumber(enemy.enemyBlueprintDropChance);
   const actual=table!==null&&roll!==null?table*roll/100:table;
   add(entry.itemName,enemy.enemyName||"Inimigo",actual,[enemy.rarity||"",table!==null?"Chance na tabela: "+table+"%":"",roll!==null?"Chance de blueprint: "+roll+"%":""].filter(Boolean).join(" · "));
  }
 }
 const scan=(node,pathParts=[])=>{
  if(Array.isArray(node)){for(const value of node)scan(value,pathParts);return;}
  if(!node||typeof node!=="object")return;
  if(node.itemName&&node.chance!==undefined){
   const label=pathParts.filter(x=>typeof x==="string"&&!/^\d+$/.test(x)&&!["rewards","reward","blueprintLocations"].includes(x)).slice(1).join(" · ")||"Tabela de recompensas";
   add(node.itemName,label,node.chance,[node.rarity||"",node.tier||"",node.state||""].filter(Boolean).join(" · "));
  }
  for(const [key,value] of Object.entries(node)){
   if(key==="_id"||key==="itemName"||key==="chance"||key==="rarity")continue;
   scan(value,[...pathParts,key]);
  }
 };
 for(const [key,value] of Object.entries(data))if(key!=="blueprintLocations")scan(value,[key]);
 return itemName=>{
  const rows=[...(index.get(itemName)||[]),...(index.get(itemName+" Blueprint")||[])];
  const seen=new Set();
  return rows.filter(row=>{if(seen.has(row.key))return false;seen.add(row.key);const {key,...data}=row;return true;}).map(({key,...row})=>row);
 };
}
function variantOf(item){
 const tags=item.tags||[];
 for(const tag of ["Prime","Kuva","Tenet","Prisma","Wraith","Vandal","Dex","Syndicate","Mara","Secura","Telos","Rakta","Sancti","Synoid","Carmine","Ceti","MK1"])if(tags.includes(tag))return tag;
 const match=String(item.name||"").match(/\b(Prime|Kuva|Tenet|Prisma|Wraith|Vandal|Dex|Mara|Secura|Telos|Rakta|Sancti|Synoid|Carmine|Ceti|MK1)\b/i);
 return match?match[1]:"";
}
function isMasteryWeapon(item,category){
 if(!item?.name||!item.uniqueName||item.masterable!==true||EXCLUDED.test(item.name))return false;
 // Modular Zaw components are not separate mastery weapons.
 if(category==="melee"&&item.uniqueName.includes("/ModularMelee"))return false;
 return true;
}
function isWeaponPart(component){
 const id=String(component?.uniqueName||"");
 return id.includes("/Types/Recipes/Weapons/WeaponParts/")||id.includes("/Types/Recipes/Weapons/WeaponParts");
}
function displayName(component){
 if(component?.name)return component.name;
 return String(component?.uniqueName||"").split("/").pop().replace(/Blueprint$/,"").replace(/([a-z])([A-Z])/g,"$1 $2");
}
async function main(){
 const arg=process.argv.indexOf("--output"),output=arg>=0?process.argv[arg+1]:"Content/weapons-data.js";
 if(!output)throw new Error("Informe o caminho de saída.");
 const [lists,drops,components]=await Promise.all([
  Promise.all(CATEGORIES.map(async ([file,category])=>[category,await fetchJson(BASE+file+".json")])),
  fetchJson(DROPS_URL),
  fetchJson(COMPONENTS_URL)
 ]);
 if(!drops||!Array.isArray(drops.blueprintLocations)||!drops.missionRewards||!Array.isArray(drops.relics))throw new Error("Dataset de drops inválido; publicação cancelada.");
 if(!Array.isArray(components))throw new Error("Catálogo de componentes inválido; publicação cancelada.");
 const componentMap=new Map(components.filter(x=>x?.uniqueName).map(x=>[x.uniqueName,x]));
 const getDrops=buildDropIndex(drops);
 const items=[];
 for(const [category,raw] of lists){
  if(!Array.isArray(raw))throw new Error("Dataset inválido para "+category);
  const selected=raw.filter(w=>isMasteryWeapon(w,category));
  const unique=new Map();
  for(const w of selected){
   // WFCD currently contains two Grimoire records for the same mastery entry.
   const previous=unique.get(w.name);
   if(!previous||((w.components||[]).length>(previous.components||[]).length))unique.set(w.name,w);
  }
  for(const w of unique.values()){
   const recipe=(w.components||[]).find(c=>String(c.uniqueName||"").includes("/Recipes/Weapons/")&&String(c.uniqueName).endsWith("Blueprint"));
   const blueprintName=recipe?displayName(componentMap.get(recipe.uniqueName)||recipe):w.name+" Blueprint";
   const parts=(w.components||[]).filter(isWeaponPart).map(c=>{
    const meta=componentMap.get(c.uniqueName)||c,name=displayName(meta);
    return {name,count:c.itemCount||1,image:meta.wikiaThumbnail||(meta.imageName?"https://wiki.warframe.com/images/"+encodeURIComponent(meta.imageName):""),wikiUrl:meta.wikiaUrl||wikiPage(name),drops:getDrops(name)};
   });
   items.push({
    id:w.uniqueName,name:w.name,category,
    variant:variantOf(w),isPrime:!!w.isPrime,
    image:w.wikiaThumbnail||(w.imageName?"https://wiki.warframe.com/images/"+encodeURIComponent(w.imageName):""),
    wikiUrl:w.wikiaUrl||wikiPage(w.name),description:w.description||"",
    drops:getDrops(blueprintName),parts
   });
  }
 }
 const ids=new Set(items.map(x=>x.id));
 const counts=Object.fromEntries(CATEGORIES.map(([f,c])=>[c,items.filter(i=>i.category===c).length]));
 if(items.length<400||ids.size!==items.length||counts.primary<180||counts.secondary<130||counts.melee<200)throw new Error("Validação das armas falhou: "+JSON.stringify(counts));
 items.sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
 const data={items,counts,updatedAt:new Date().toISOString(),source:"WFCD mastery weapon catalogue + Warframe Wiki media + parsed Digital Extremes drop tables",sourceUrl:"https://wiki.warframe.com/w/Mastery_Rank_Checklist"};
 await fs.mkdir(path.dirname(output),{recursive:true});
 await fs.writeFile(output,"/* Gerado automaticamente pelo GitHub Actions. */\nwindow.WFC_WEAPONS_SNAPSHOT="+JSON.stringify(data)+";\n","utf8");
 console.log("Armas de Maestria validadas:",counts,"Total:",items.length,"Peças:",items.reduce((n,w)=>n+w.parts.length,0));
}
main().catch(e=>{console.error("Geração de armas cancelada:",e);process.exitCode=1;});
