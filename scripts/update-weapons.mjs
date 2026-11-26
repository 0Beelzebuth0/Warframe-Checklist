import fs from "node:fs/promises";
import path from "node:path";

const BASE="https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/";
const CATEGORIES=[["Primary","primary"],["Secondary","secondary"],["Melee","melee"]];
const EXCLUDED=/^(?:Excalibur Prime)$/i;
async function fetchJson(url){
 const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"Warframe-Checklist-GitHub-Actions"},signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw new Error("HTTP "+r.status+" ao consultar "+url);return r.json();
}
function wikiUrl(item){return item.wikiaUrl||"https://wiki.warframe.com/w/"+encodeURIComponent(String(item.name||"").replace(/ /g,"_"));}
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
 const lists=await Promise.all(CATEGORIES.map(async ([file,category])=>[category,await fetchJson(BASE+file+".json")]));
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
