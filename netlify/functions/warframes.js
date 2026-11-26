const WARFRAMES_URL="https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Warframes.json";
const COMPONENTS_URL="https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Components.json";
const PARTS=[["neuroptics","Helmet"],["chassis","Chassis"],["systems","Systems"]];
const excluded=new Set(["Excalibur Prime"]);
function cleanDrop(d){
 const chance=Number(d.chance);
 return {source:d.location||d.place||d.enemyName||d.name||"Fonte listada na tabela",chance:Number.isFinite(chance)?chance:null,detail:[d.rotation?"Rotação "+d.rotation:"",d.rarity||""].filter(Boolean).join(" · "),sourceUrl:d.url||"https://www.warframe.com/droptables"};
}
exports.handler=async function(){
 try{
  const [wr,cr]=await Promise.all([fetch(WARFRAMES_URL),fetch(COMPONENTS_URL)]);
  if(!wr.ok||!cr.ok)throw new Error("Falha ao obter catálogo WFCD");
  const [frames,components]=await Promise.all([wr.json(),cr.json()]);
  const catalog=new Map((Array.isArray(components)?components:[]).map(c=>[c.uniqueName,c]));
  const items=[];
  for(const f of (Array.isArray(frames)?frames:[])){
   if(f.type!=="Warframe"||!f.masterable||excluded.has(f.name))continue;
   const refs=Array.isArray(f.components)?f.components:[];
   const parts=[];
   for(const [id,kind] of PARTS){
    const ref=refs.find(x=>new RegExp(kind+"Component$","i").test(x.uniqueName||""));
    const c=ref&&catalog.get(ref.uniqueName);
    const drops=Array.isArray(c&&c.drops)?c.drops.map(cleanDrop):[];
    parts.push({id,label:id==="neuroptics"?"Neuroptics":id[0].toUpperCase()+id.slice(1),drops});
   }
   // Keep every standard frame; only include Prime variants with at least one currently listed component source.
   if(f.isPrime&&!parts.some(p=>p.drops.length))continue;
   items.push({id:f.uniqueName,name:f.name,description:f.description||"",image:"https://cdn.warframestat.us/img/"+encodeURIComponent(f.imageName||""),wikiUrl:f.wikiaUrl||"https://wiki.warframe.com/w/"+encodeURIComponent(f.name.replace(/ /g,"_")),parts,isPrime:!!f.isPrime});
  }
  if(!items.length)throw new Error("Nenhum Warframe válido foi montado");
  return {statusCode:200,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=3600","Access-Control-Allow-Origin":"*"},body:JSON.stringify({items,updatedAt:new Date().toISOString(),source:"WFCD warframe-items"})};
 }catch(error){
  return {statusCode:502,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"},body:JSON.stringify({error:"Não foi possível atualizar os dados de Warframes.",detail:error.message})};
 }
};