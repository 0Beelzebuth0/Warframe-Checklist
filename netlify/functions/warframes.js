const WARFRAMES_URL="https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Warframes.json";
const DROP_BASE="https://raw.githubusercontent.com/WFCD/warframe-drop-data/master/data/";
const DROP_FILES=["blueprintLocations.json","missionRewards.json","relics.json","cetusBountyRewards.json","solarisBountyRewards.json","zarimanRewards.json","transientRewards.json"];
const PARTS=[["neuroptics","Neuroptics"],["chassis","Chassis"],["systems","Systems"]];
const EXCLUDED=new Set(["Excalibur Prime"]);
const TABLE_URL="https://www.warframe.com/droptables";
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function findDrops(itemName,data){
 const out=[],seen=new Set();
 const get=key=>{const value=data[key];return value&&value[key]?value[key]:value;};
 const add=(source,chance,detail="")=>{
  const k=[source,chance,detail].join("|");if(seen.has(k))return;seen.add(k);
  out.push({source,chance,detail,sourceUrl:TABLE_URL});
 };
 for(const entry of get("blueprintLocations")||[]){
  if(entry.itemName!==itemName)continue;
  for(const enemy of entry.enemies||[]){
   const itemChance=num(enemy.chance),tableChance=num(enemy.enemyItemDropChance);
   const chance=itemChance!==null&&tableChance!==null?itemChance*tableChance/100:itemChance;
   const detail=[itemChance!==null?"Chance na tabela: "+itemChance+"%":"",tableChance!==null?"Chance de drop de item: "+tableChance+"%":"",enemy.rarity||""].filter(Boolean).join(" · ");
   add(enemy.enemyName||"Inimigo",chance,detail);
  }
 }
 const missions=get("missionRewards")||{};
 for(const [planet,nodes] of Object.entries(missions)){
  for(const [node,mission] of Object.entries(nodes||{})){
   for(const [rotation,rewards] of Object.entries(mission.rewards||{})){
    for(const reward of rewards||[])if(reward.itemName===itemName)add(planet+" · "+node,num(reward.chance),"Rotação "+rotation+(reward.rarity?" · "+reward.rarity:""));
   }
  }
 }
 for(const relic of get("relics")||[]){
  const states=Array.isArray(relic.rewards)?[[relic.state||"Intact",relic.rewards]]:Object.entries(relic.rewards||{});
  for(const [refinement,rewards] of states)for(const reward of rewards||[])if(reward.itemName===itemName)add((relic.tier||"") +" "+(relic.relicName||"Relíquia"),num(reward.chance),"Refinamento "+refinement+(reward.rarity?" · "+reward.rarity:""));
 }
 for(const key of ["cetusBountyRewards","solarisBountyRewards","zarimanRewards","transientRewards"]){
  for(const entry of get(key)||[]){
   for(const [rotation,rewards] of Object.entries(entry.rewards||{})){
    for(const reward of rewards||[])if(reward.itemName===itemName)add(entry.bountyLevel||entry.objectiveName||key,num(reward.chance),[reward.stage||"",rotation,reward.rarity||""].filter(Boolean).join(" · "));
   }
  }
 }
 return out;
}
exports.handler=async function(){
 try{
  const responses=await Promise.all([fetch(WARFRAMES_URL),...DROP_FILES.map(file=>fetch(DROP_BASE+file))]);
  if(responses.some(r=>!r.ok))throw new Error("Falha ao obter catálogo ou tabelas oficiais processadas");
  const parsed=await Promise.all(responses.map(r=>r.json()));
  const frames=parsed[0],drops={};
  DROP_FILES.forEach((file,i)=>drops[file.replace(".json","")]=parsed[i+1]);
  const items=[];
  for(const frame of Array.isArray(frames)?frames:[]){
   if(frame.type!=="Warframe"||!frame.masterable||EXCLUDED.has(frame.name))continue;
   const parts=PARTS.map(([id,label])=>{
    const itemName=frame.name+" "+label+" Blueprint";
    return {id,label,drops:findDrops(itemName,drops)};
   });
   // Standard frames remain listed. Prime frames only appear while at least one part has a current source.
   if(frame.isPrime&&!parts.some(part=>part.drops.length))continue;
   items.push({id:frame.uniqueName,name:frame.name,description:frame.description||"",image:"https://cdn.warframestat.us/img/"+encodeURIComponent(frame.imageName||""),wikiUrl:frame.wikiaUrl||"https://wiki.warframe.com/w/"+encodeURIComponent(frame.name.replace(/ /g,"_")),parts,isPrime:!!frame.isPrime});
  }
  if(!items.length)throw new Error("Nenhum Warframe válido foi montado");
  return {statusCode:200,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=3600"},body:JSON.stringify({items,updatedAt:new Date().toISOString(),source:"WFCD warframe-items + official DE drop tables"})};
 }catch(error){
  return {statusCode:502,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"},body:JSON.stringify({error:"Não foi possível atualizar os dados de Warframes.",detail:error.message})};
 }
};