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
function pageUrl(title){return wikiPage(title);}
function normalizeDropName(value){
 return String(value||"").replace(/\s+Blueprint$/i,"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
}
function wikiTitle(weapon){
 const raw=weapon.wikiaUrl||wikiPage(weapon.name);
 try{return decodeURIComponent(new URL(raw).pathname.split("/").pop()).replace(/_/g," ");}catch{return weapon.name;}
}
function stripWikiHtml(value){
 return String(value||"").replace(/<sup[\s\S]*?<\/sup>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<\/(?:p|li|div|tr|td|th)>/gi," ").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim();
}
function acquisitionHtmlSection(html){
 const source=String(html||""),heading=/<h2\b[^>]*>[\s\S]*?Acquisition[\s\S]*?<\/h2>/i.exec(source);
 if(!heading)return "";
 const start=heading.index+heading[0].length,tail=source.slice(start),next=/<h2\b/i.exec(tail);
 return next?tail.slice(0,next.index):tail;
}
function acquisitionSection(wikitext){
 const source=String(wikitext||""),heading=/^==\s*Acquisition\s*==\s*$/mi.exec(source);
 if(!heading)return "";
 const start=heading.index+heading[0].length,tail=source.slice(start),next=/^==\s*[^=]/m.exec(tail);
 return next?tail.slice(0,next.index):tail;
}
function parseWikiAcquisition(page,weapon){
 const htmlSection=acquisitionHtmlSection(page?.html),wikitext=String(page?.wikitext||"");
 const result={blueprint:[],parts:new Map()};
 const add=(key,source,detail)=>{
  const target=key==="blueprint"?result.blueprint:(result.parts.get(key)||[]);
  if(!target.some(x=>x.source===source&&x.detail===detail))target.push({source,chance:null,detail,sourceUrl:wikiPage(weapon.name)});
  if(key!=="blueprint")result.parts.set(key,target);
 };
 const tables=[...htmlSection.matchAll(/<table\b[\s\S]*?<\/table>/gi)];
 for(const tableMatch of tables){
  const table=tableMatch[0],rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if(!rows.length)continue;
  let headers=[];
  for(const row of rows){
   const th=[...row[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(x=>stripWikiHtml(x[1]));
   if(th.length){headers=th;continue;}
   const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>stripWikiHtml(x[1]));
   if(!headers.length||!cells.length)continue;
   cells.forEach((cell,index)=>{
    const header=normalizeDropName(headers[index]||"");
    if(!header)return;
    const key=header==="blueprint"||header==="mainblueprint"?"blueprint":header;
    for(const m of cell.matchAll(/\b(Lith|Meso|Neo|Axi)\s+([A-Z]\d+)\s+(Common|Uncommon|Rare)(?:\s*\((V|B)\))?/g)){
     const source=m[1]+" "+m[2]+" Relic";
     const detail=m[3]+(m[4]==="V"?" · Vaulted":m[4]==="B"?" · Baro Ki'Teer exclusive":"");
     add(key,source,detail);
    }
   });
  }
 }
 if(!result.blueprint.length){
  let plain=stripWikiHtml(htmlSection);
  if(!plain)plain=acquisitionSection(wikitext).replace(/\{\|[\s\S]*?\|\}/g," ").replace(/\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g,"$1").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  if(plain&&plain.length<1800)add("blueprint","Weapon Wiki · Acquisition",plain.slice(0,700));
 }
 return result;
}
async function fetchWikiPages(weapons){
 const titles=[...new Set(weapons.map(wikiTitle))],pages=new Map(),batches=[];
 for(let i=0;i<titles.length;i+=35)batches.push(titles.slice(i,i+35));
 for(let i=0;i<batches.length;i+=3){
  await Promise.all(batches.slice(i,i+3).map(async batch=>{
   const query=batch.map(x=>encodeURIComponent(x)).join("%7C");
   const url="https://wiki.warframe.com/api.php?action=query&format=json&prop=extracts%7Crevisions&explaintext=0&exsectionformat=wiki&rvprop=content&rvslots=main&titles="+query;
   const data=await fetchJson(url);
   for(const page of Object.values(data.query?.pages||{})){
    const revision=page.revisions?.[0],wikitext=revision?.slots?.main?.content??revision?.slots?.main?.["*"]??revision?.["*"]??"";
    pages.set(normalizeDropName(page.title),{html:page.extract||"",wikitext});
   }
  }));
 }
 const templated=[...pages.entries()].filter(([,page])=>/\{\{\s*(?:PrimeTable|RelicTable)\b/i.test(page.wikitext));
 for(let i=0;i<templated.length;i+=6){
  await Promise.all(templated.slice(i,i+6).map(async ([key,page])=>{
   const weaponTitle=titles.find(title=>normalizeDropName(title)===key)||key;
   const url="https://wiki.warframe.com/api.php?action=parse&format=json&prop=text&page="+encodeURIComponent(weaponTitle);
   const rendered=await fetchJson(url);
   const html=rendered.parse?.text?.["*"]??rendered.parse?.text??"";
   if(html)pages.set(key,{...page,html});
  }));
 }
 console.log("Páginas Wiki renderizadas para tabelas de Relíquias:",templated.length);
 if(pages.size<Math.min(100,titles.length*0.5))throw new Error("A Wiki não retornou páginas suficientes para validar as aquisições ("+pages.size+"/"+titles.length+").");
 return weapon=>pages.get(normalizeDropName(wikiTitle(weapon)))||{html:"",wikitext:""};
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
 const [lists,components]=await Promise.all([
  Promise.all(CATEGORIES.map(async ([file,category])=>[category,await fetchJson(BASE+file+".json")])),
  fetchJson(COMPONENTS_URL)
 ]);
 if(!Array.isArray(components))throw new Error("Catálogo de componentes inválido; publicação cancelada.");
 const componentMap=new Map(components.filter(x=>x?.uniqueName).map(x=>[x.uniqueName,x]));
 const items=[];
 const allRaw=lists.flatMap(([category,raw])=>raw.filter(w=>isMasteryWeapon(w,category)).map(w=>({w,category})));
 const wikiDropLookup=await fetchWikiPages(allRaw.map(x=>x.w));
 const debugAk=allRaw.find(x=>x.w.name==="Akstiletto Prime")?.w;
 if(debugAk){const pg=wikiDropLookup(debugAk),hi=pg.html.indexOf("Acquisition"),wi=pg.wikitext.indexOf("Acquisition");console.log("WIKI SAMPLE",JSON.stringify({htmlLength:pg.html.length,htmlSnippet:pg.html.slice(Math.max(0,hi-200),hi+2400),wikitextLength:pg.wikitext.length,wikitextSnippet:pg.wikitext.slice(Math.max(0,wi-100),wi+1800),parsed:(()=>{const x=parseWikiAcquisition(pg,debugAk);return {blueprint:x.blueprint,parts:[...x.parts.entries()]};})()}));}

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
   const wikiAcquisition=parseWikiAcquisition(wikiDropLookup(w),w);
   const parts=(w.components||[]).filter(isWeaponPart).map(c=>{
    const meta=componentMap.get(c.uniqueName)||c,token=String(c.uniqueName||"").split("/").pop();
    const compact=normalizeDropName(w.name),suffix=token.toLowerCase().startsWith(compact)?token.slice(compact.length).replace(/([a-z])([A-Z])/g,"$1 $2").trim():"";
    const fallback=displayName(meta),name=suffix?w.name+" "+suffix:(normalizeDropName(fallback).startsWith(compact)?fallback:w.name+" "+fallback);
    return {name,count:c.itemCount||1,image:meta.wikiaThumbnail||(meta.imageName?"https://wiki.warframe.com/images/"+encodeURIComponent(meta.imageName):""),wikiUrl:(w.wikiaUrl||wikiPage(w.name))+"#Acquisition",drops:wikiAcquisition.parts.get(normalizeDropName(name.replace(w.name,"").trim()))||[]};
   });
   items.push({
    id:w.uniqueName,name:w.name,category,
    variant:variantOf(w),isPrime:!!w.isPrime,
    image:w.wikiaThumbnail||(w.imageName?"https://wiki.warframe.com/images/"+encodeURIComponent(w.imageName):""),
    wikiUrl:w.wikiaUrl||wikiPage(w.name),description:w.description||"",
    drops:wikiAcquisition.blueprint,parts
   });
  }
 }
 const ids=new Set(items.map(x=>x.id));
 const counts=Object.fromEntries(CATEGORIES.map(([f,c])=>[c,items.filter(i=>i.category===c).length]));
 if(items.length<400||ids.size!==items.length||counts.primary<180||counts.secondary<130||counts.melee<200)throw new Error("Validação das armas falhou: "+JSON.stringify(counts));
 items.sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
 const data={items,counts,updatedAt:new Date().toISOString(),source:"WFCD mastery weapon catalogue + Warframe Wiki weapon acquisition pages and component artwork",sourceUrl:"https://wiki.warframe.com/w/Mastery_Rank_Checklist"};
 await fs.mkdir(path.dirname(output),{recursive:true});
 await fs.writeFile(output,"/* Gerado automaticamente pelo GitHub Actions. */\nwindow.WFC_WEAPONS_SNAPSHOT="+JSON.stringify(data)+";\n","utf8");
 const allParts=items.flatMap(w=>w.parts||[]);
 console.log("Armas de Maestria validadas:",counts,"Total:",items.length,"Peças:",allParts.length);
 console.log("Dados Wiki:",{paginasConsultadas:allRaw.length,armasComProjetoDrop:items.filter(w=>w.drops.length).length,pecasComImagem:allParts.filter(p=>p.image).length,pecasComDrop:allParts.filter(p=>p.drops.length).length});
}
main().catch(e=>{console.error("Geração de armas cancelada:",e);process.exitCode=1;});
