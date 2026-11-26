import fs from "node:fs/promises";
import path from "node:path";

const BASE="https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/";
const CATEGORIES=[["Primary","primary"],["Secondary","secondary"],["Melee","melee"]];
const DROPS_URL="https://raw.githubusercontent.com/WFCD/warframe-drop-data/main/data/all.json";
const EXCLUDED=/^(?:Excalibur Prime)$/i;
async function fetchJson(url){
 const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"Warframe-Checklist-GitHub-Actions"},signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw new Error("HTTP "+r.status+" ao consultar "+url);return r.json();
}
function wikiUrl(item){return item.wikiaUrl||"https://wiki.warframe.com/w/"+encodeURIComponent(String(item.name||"").replace(/ /g,"_"));}

function unwrap(data,key){const v=data&&data[key];return v&&typeof v==="object"&&!Array.isArray(v)&&key in v?v[key]:v;}
function chanceNumber(v){if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=100?n:null;}
function pageUrl(title){return "https://wiki.warframe.com/w/"+encodeURIComponent(String(title||"").trim().replace(/\\s+/g,"_"));}
function buildDrops(itemName,data){
 const out=[],seen=new Set();
 const add=(source,chance,detail="")=>{const n=chanceNumber(chance),key=[source,n,detail].join("|");if(seen.has(key))return;seen.add(key);out.push({source:String(source||"Fonte não identificada"),chance:n,detail:String(detail||""),sourceUrl:pageUrl(String(source).split(" · ").pop())});};
 for(const entry of unwrap(data,"blueprintLocations")||[]){if(entry&&entry.itemName===itemName)for(const enemy of entry.enemies||[]){const table=chanceNumber(enemy.chance),drop=chanceNumber(enemy.enemyItemDropChance),total=table!==null&&drop!==null?table*drop/100:table;add(enemy.enemyName||"Inimigo",total,[table!==null?"Chance na tabela: "+table+"%":"",drop!==null?"Chance de drop de item: "+drop+"%":"",enemy.rarity||""].filter(Boolean).join(" · "));}}
 const missions=unwrap(data,"missionRewards")||{};
 for(const [planet,nodes] of Object.entries(missions))for(const [node,mission] of Object.entries(nodes||{}))for(const [rotation,rewards] of Object.entries(mission&&mission.rewards||{}))for(const reward of Array.isArray(rewards)?rewards:[])if(reward&&reward.itemName===itemName)add(planet+" · "+node,reward.chance,"Rotação "+rotation+(reward.rarity?" · "+reward.rarity:""));
 for(const relic of unwrap(data,"relics")||[]){const rewards=Array.isArray(relic.rewards)?relic.rewards:Object.values(relic.rewards||{}).flat();for(const reward of rewards)if(reward&&reward.itemName===itemName)add([relic.tier,relic.relicName].filter(Boolean).join(" ")||"Relíquia",reward.chance,"Refinamento "+(relic.state||"não especificado")+(reward.rarity?" · "+reward.rarity:""));}
 return out;
}

function variantOf(item){
 const tags=item.tags||[];
 for(const tag of ["Prime","Kuva","Tenet","Prisma","Wraith","Vandal","Dex","Syndicate","Mara","Secura","Telos","Rakta","Sancti","Synoid","Carmine","Ceti","MK1"])if(tags.includes(tag))return tag;
 const name=item.name||"";
 const match=name.match(/\b(Prime|Kuva|Tenet|Prisma|Wraith|Vandal|Dex|Mara|Secura|Telos|Rakta|Sancti|Synoid|Carmine|Ceti|MK1)\b/i);
 return match?match[1]:"";
}
function available(item){
 if(!item||!item.name||!item.uniqueName||item.codexSecret||item.excludeFromCodex||item.wikiAvailable===false||EXCLUDED.test(item.name))return false;
 if(item.vaulted===true)return false;
 return true;
}
async function main(){
 const arg=process.argv.indexOf("--output"),output=arg>=0?process.argv[arg+1]:"Content/weapons-data.js";
 if(!output)throw new Error("Informe o caminho de saída.");
 const [lists,drops]=await Promise.all([Promise.all(CATEGORIES.map(async ([file,category])=>[category,await fetchJson(BASE+file+".json")])),fetchJson(DROPS_URL)]);
 if(!drops||!Array.isArray(drops.blueprintLocations)||!drops.missionRewards||!Array.isArray(drops.relics))throw new Error("Dataset oficial de drops inválido; publicação cancelada.");
 const items=[];
 for(const [category,raw] of lists){
  if(!Array.isArray(raw))throw new Error("Dataset inválido para "+category);
  for(const w of raw){
   if(!available(w))continue;
   items.push({
    id:w.uniqueName,name:w.name,category,
    type:w.type||w.productCategory||"Outros",
    variant:variantOf(w),isPrime:!!w.isPrime,
    image:w.wikiaThumbnail|| (w.imageName?"https://cdn.warframestat.us/img/"+encodeURIComponent(w.imageName):""),
    wikiUrl:wikiUrl(w),description:w.description||""
   });
  }
 }
 const ids=new Set(items.map(x=>x.id));
 if(items.length<150||ids.size!==items.length)throw new Error("Validação das armas falhou: "+items.length+" itens únicos.");
 const counts=Object.fromEntries(CATEGORIES.map(([f,c])=>[c,items.filter(i=>i.category===c).length]));
 for(const [,c] of CATEGORIES)if(counts[c]<20)throw new Error("Categoria incompleta: "+c);
 items.sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
 const data={items,counts,updatedAt:new Date().toISOString(),source:"WFCD/warframe-items (game data)",sourceUrl:"https://github.com/WFCD/warframe-items"};
 await fs.mkdir(path.dirname(output),{recursive:true});
 await fs.writeFile(output,"/* Gerado automaticamente pelo GitHub Actions. */\nwindow.WFC_WEAPONS_SNAPSHOT="+JSON.stringify(data)+";\n","utf8");
 console.log("Armas validadas:",counts,"Total:",items.length);
}
main().catch(e=>{console.error("Geração de armas cancelada:",e);process.exitCode=1;});
