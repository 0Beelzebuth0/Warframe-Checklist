import fs from "node:fs/promises";
import path from "node:path";

const BASE="https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/";
const CATEGORIES=[["Primary","primary"],["Secondary","secondary"],["Melee","melee"]];
const COMPONENTS_URL=BASE+"Components.json";
const EXCLUDED=/^(?:Excalibur Prime)$/i;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fetchJson(url){
 for(let attempt=0;attempt<6;attempt++){
  const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"Warframe-Checklist-GitHub-Actions"},signal:AbortSignal.timeout(90000)});
  if(r.ok)return r.json();
  if(r.status===429||r.status>=500){
   const retry=Number(r.headers.get("retry-after"));
   await sleep(Number.isFinite(retry)&&retry>0?retry*1000:Math.min(30000,1500*Math.pow(2,attempt)));
   continue;
  }
  throw new Error("HTTP "+r.status+" ao consultar "+url);
 }
 throw new Error("A Wiki limitou repetidamente a consulta após novas tentativas: "+url);
}

const wikiPage=n=>"https://wiki.warframe.com/w/"+encodeURIComponent(String(n||"").trim().replace(/\s+/g,"_"));
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
 const source=String(html||"");
 // MediaWiki normally places id="Acquisition" on a nested .mw-headline span,
 // not on the h2 element itself. Match the whole heading in either format.
 const headings=[...source.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi)];
 const index=headings.findIndex(match=>/id\s*=\s*["']Acquisition["']/i.test(match[0])||
  /(?:^|>)\s*Acquisition\s*(?:<|$)/i.test(stripWikiHtml(match[0])));
 if(index<0)return "";
 const heading=headings[index],start=heading.index+heading[0].length,tail=source.slice(start);
 const next=/<h2\b/i.exec(tail);
 return next?tail.slice(0,next.index):tail;
}
function acquisitionSection(wikitext){
 const source=String(wikitext||"");
 const heading=/^==\s*Acquisition\s*==\s*$/mi.exec(source);
 if(!heading)return "";
 const start=heading.index+heading[0].length,tail=source.slice(start),next=/^==\s*[^=]/m.exec(tail);
 return next?tail.slice(0,next.index):tail;
}
function parseWikiAcquisition(page,weapon){
 const htmlSection=acquisitionHtmlSection(page?.html),wikitext=String(page?.wikitext||"");
 const result={blueprint:[],parts:new Map(),sectionFound:!!htmlSection||!!acquisitionSection(wikitext)};
 const base=normalizeDropName(weapon.name);
 const add=(key,source,detail,chance=null)=>{
  if(!key||!source)return;
  const target=key==="blueprint"?result.blueprint:(result.parts.get(key)||[]);
  if(!target.some(x=>x.source===source&&x.detail===detail&&x.chance===chance))
   target.push({source,chance,detail,sourceUrl:wikiPage(weapon.name)+"#Acquisition"});
  if(key!=="blueprint")result.parts.set(key,target);
 };
 const partKeyFor=value=>{
  const raw=String(value||"");
  let normalized=normalizeDropName(raw);
  if(!normalized)return "";
  let suffix=normalized.startsWith(base)?normalized.slice(base.length):normalized;
  suffix=suffix.replace(/blueprint$/,"");
  const aliases={gunchassis:"chassis",weaponchassis:"chassis",mainblueprint:"blueprint",receiver:"receiver",barrel:"barrel",stock:"stock",handle:"handle",blade:"blade",grip:"grip",neuroptics:"neuroptics",systems:"systems",string:"string",upperlimb:"upperlimb",lowerlimb:"lowerlimb",ornament:"ornament",disc:"disc",pouch:"pouch",cartridge:"cartridge",cylinder:"cylinder",rotor:"rotor",stars:"stars",sight:"sight",scope:"scope",hilt:"hilt",guard:"guard",gauntlet:"gauntlet",link:"link"};
  if(aliases[suffix])return aliases[suffix];
  if(aliases[normalized])return aliases[normalized];
  if(!suffix&&/\bblueprint\b/i.test(raw))return "blueprint";
  return suffix||"";
 };
 const parseChance=value=>{
  const raw=String(value||"").trim().replace(/,/g,".");
  const match=raw.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if(!match)return null;
  const n=Number(match[1]);
  return Number.isFinite(n)&&n>=0&&n<=100?n:null;
 };
 const relicPattern=/\b(Lith|Meso|Neo|Axi|Requiem|Omnia)\s+([A-Z]\d+|[IVX]+)\b(?:\s*\(([VB])\))?/gi;
 const tables=[...htmlSection.matchAll(/<table\b[\s\S]*?<\/table>/gi)];
 for(const tableMatch of tables){
  const rows=[...tableMatch[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  let headers=[];
  for(const row of rows){
   const th=[...row[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(x=>stripWikiHtml(x[1]));
   if(th.length){headers=th;continue;}
   const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>stripWikiHtml(x[1]));
   if(!cells.length)continue;
   const headerKeys=headers.map(normalizeDropName);
   const itemCol=headerKeys.findIndex(x=>["item","itemname","part","partname","reward","component","componentname","blueprint"].includes(x));
   const sourceCol=headerKeys.findIndex(x=>["source","dropsource","droplocation","location","mission"].includes(x));
   const chanceCol=headerKeys.findIndex(x=>["chance","dropchance","droprate","probability"].includes(x));
   if(itemCol>=0&&cells[itemCol]){
    const key=partKeyFor(cells[itemCol]);
    if(key&&sourceCol>=0&&cells[sourceCol]){
     const detail=[cells[headerKeys.indexOf("expected")],cells[headerKeys.indexOf("nearlyguaranteed")]].filter(Boolean).join(" · ");
     add(key,cells[sourceCol],detail, chanceCol>=0?parseChance(cells[chanceCol]):null);
    }
    // Prime-style tables sometimes split the component, relic and rarity into separate cells.
    if(key)cells.forEach(cell=>{
     for(const match of cell.matchAll(relicPattern)){
      const rarity=(cells.find(x=>/\b(Common|Uncommon|Rare)\b/i.test(x))||"").match(/Common|Uncommon|Rare/i)?.[0]||"";
      const vault=match[3]==="V"?"Vaulted":match[3]==="B"?"Baro Ki'Teer exclusive":"";
      add(key,match[1]+" "+match[2]+" Relic",[rarity,vault].filter(Boolean).join(" · "),null);
     }
    });
   }
   // Other Prime tables put the component names in the column headings.
   cells.forEach((cell,index)=>{
    const key=partKeyFor(headers[index]||"");
    if(!key||!cell)return;
    for(const match of cell.matchAll(relicPattern)){
     const rarity=cell.match(/Common|Uncommon|Rare/i)?.[0]||"";
     const vault=match[3]==="V"?"Vaulted":match[3]==="B"?"Baro Ki'Teer exclusive":"";
     add(key,match[1]+" "+match[2]+" Relic",[rarity,vault].filter(Boolean).join(" · "),null);
    }
   });
  }
 }
 // Acquisition pages may use lists instead of tables. Keep only explicit item/component lines.
 const knownParts=["barrel","receiver","stock","handle","blade","grip","neuroptics","chassis","systems","string","upperlimb","lowerlimb","ornament","disc","pouch","cartridge","cylinder","rotor","stars","sight","scope","hilt","guard","gauntlet","link"];
 const listSource=htmlSection.replace(/<table\b[\s\S]*?<\/table>/gi," ");
 const listLines=[...listSource.matchAll(/<(?:li|p)\b[^>]*>([\s\S]*?)<\/(?:li|p)>/gi)].map(match=>stripWikiHtml(match[1]));
 for(const line of listLines){
  if(!line)continue;
  const normalized=normalizeDropName(line);
  let key=/\bblueprint\b/i.test(line)?"blueprint":knownParts.find(part=>normalized.includes(part))||(/\b(Market|Baro Ki'Teer|Syndicate|Dojo|Research|Quest|mission|bounty|vendor|purchased|purchase|event|enemy|drop)\b/i.test(line)?"blueprint":"");
  if(!key)continue;
  const chanceMatch=line.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const chance=chanceMatch?parseChance(chanceMatch[1]):null;
  add(key,line,"Acquisition (lista/texto da Wiki)",chance);
 }
 return result;
}
async function fetchWikiPages(weapons){
 const titles=[...new Set(weapons.map(wikiTitle))],pages=new Map(),batches=[];
 for(let i=0;i<titles.length;i+=35)batches.push(titles.slice(i,i+35));
 for(let i=0;i<batches.length;i+=3){
  await Promise.all(batches.slice(i,i+3).map(async batch=>{
   const query=batch.map(x=>encodeURIComponent(x)).join("%7C");
   const url="https://wiki.warframe.com/api.php?action=query&format=json&redirects=1&prop=extracts%7Crevisions&explaintext=0&exsectionformat=wiki&rvprop=content&rvslots=main&titles="+query;
   const data=await fetchJson(url);
   for(const page of Object.values(data.query?.pages||{})){
    const revision=page.revisions?.[0],wikitext=revision?.slots?.main?.content??revision?.slots?.main?.["*"]??revision?.["*"]??"";
    pages.set(normalizeDropName(page.title),{title:page.title,html:page.extract||"",wikitext});
   }
   for(const redirect of data.query?.redirects||[]){
    const resolved=pages.get(normalizeDropName(redirect.to));
    if(resolved)pages.set(normalizeDropName(redirect.from),resolved);
   }
  }));
 }
 const templated=[...pages.entries()].filter(([,page])=>{const acq=acquisitionSection(page.wikitext);return !acquisitionHtmlSection(page.html)&&!!acq||/\{\|/.test(acq)||/\{\{\s*(?!BuildAutomatic\b)[^}]+\}\}/i.test(acq);});
 for(let i=0;i<templated.length;i+=2){
  await Promise.all(templated.slice(i,i+2).map(async ([key,page])=>{
   const weaponTitle=titles.find(title=>normalizeDropName(title)===key)||key;
   const url="https://wiki.warframe.com/api.php?action=parse&format=json&prop=text&page="+encodeURIComponent(weaponTitle);
   const rendered=await fetchJson(url);
   const html=rendered.parse?.text?.["*"]??rendered.parse?.text??"";
   if(html)pages.set(key,{...page,html});
  }));
  await sleep(350);
 }
 console.log("Páginas Wiki renderizadas para tabelas de aquisição:",templated.length);

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
 const missingAcquisitionPages=[...new Set(allRaw.filter(x=>!wikiDropLookup(x.w).sectionFound).map(x=>wikiTitle(x.w)))];
 if(missingAcquisitionPages.length)throw new Error("Páginas sem seção Acquisition identificada ("+missingAcquisitionPages.length+"): "+missingAcquisitionPages.slice(0,30).join("; "));

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
   const wikiAcquisition=parseWikiAcquisition(wikiDropLookup(w),w);
   const parts=(w.components||[]).filter(isWeaponPart).map(c=>{
    const meta=componentMap.get(c.uniqueName)||c,token=String(c.uniqueName||"").split("/").pop();
    const compact=normalizeDropName(w.name),suffix=token.toLowerCase().startsWith(compact)?token.slice(compact.length).replace(/([a-z])([A-Z])/g,"$1 $2").trim():"";
    const fallback=displayName(meta),name=suffix?w.name+" "+suffix:(normalizeDropName(fallback).startsWith(compact)?fallback:w.name+" "+fallback);
    const rawPartKey=normalizeDropName(name.replace(w.name,"").trim()),partKey=({gunchassis:"chassis",weaponchassis:"chassis"})[rawPartKey]||rawPartKey;
    return {name,count:c.itemCount||1,image:meta.wikiaThumbnail||(meta.imageName?"https://wiki.warframe.com/images/"+encodeURIComponent(meta.imageName):""),wikiUrl:(w.wikiaUrl||wikiPage(w.name))+"#Acquisition",drops:wikiAcquisition.parts.get(partKey)||[]};
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
 console.log("Auditoria Acquisition Wiki:",{paginasUnicas:[...new Set(allRaw.map(w=>wikiTitle(w)))].length,paginasComSecaoAcquisition:[...new Set(allRaw.filter(w=>wikiDropLookup(w).sectionFound).map(w=>wikiTitle(w)))].length,paginasComDropDeProjeto:items.filter(w=>w.drops.length).length,pecasComImagem:allParts.filter(p=>p.image).length,pecasComDrop:allParts.filter(p=>p.drops.length).length,armasSemDropDeProjeto:items.filter(w=>!w.drops.length).map(w=>w.name).slice(0,30),pecasSemDrop:allParts.filter(p=>!p.drops.length).length});
}
main().catch(e=>{console.error("Geração de armas cancelada:",e);process.exitCode=1;});
