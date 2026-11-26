/* Warframe Checklist — shared core. Used by index.html (Lobby) and by every Content/*.html module page. */
(function () {
"use strict";
const W = window, I = W.WFC_I18N, LANGS = W.WFC_LANGS;
const K = { lang: "wfc.lang", done: "wfc.done.v2", view: "wfc.view", migrated: "wfc.migrated" };
const OLD_KEY = "a-lista-warframe-progress-v1";           // progress saved by the previous version (Quests only)
const WFC = W.WFC = { mods: {}, root: document.body.dataset.root || "", spa: false };
let lang = "en", done = {}, rerender = () => {};

const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const $ = (s, r) => (r || document).querySelector(s);

/* ---------- i18n ---------- */
const dict = () => I[lang] || I.en;
function t(k, v) {
  let s = dict()[k] ?? I.en[k] ?? k;
  if (v) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in v ? v[n] : m));
  return s;
}
const tpl = s => String(s).replace(/\{(\w+)\}/g, (m, k) => dict()[k] ?? I.en[k] ?? m);
function applyI18n(root) {
  (root || document).querySelectorAll("[data-i18n]").forEach(e => { e.textContent = t(e.dataset.i18n); });
  (root || document).querySelectorAll("[data-ph]").forEach(e => { e.placeholder = t(e.dataset.ph); });
}

/* ---------- storage ---------- */
function load() {
  const l = lsGet(K.lang); lang = I[l] ? l : "en";
  try { done = JSON.parse(lsGet(K.done) || "{}") || {}; } catch (e) { done = {}; }
  if (!lsGet(K.migrated)) {                                // migrate progress of the old single-page version
    try {
      const old = JSON.parse(lsGet(OLD_KEY) || "{}");
      Object.keys(old).forEach(k => { if (old[k] === true) done["01JOURNEYS|" + k] = true; });
      lsSet(K.done, JSON.stringify(done));
    } catch (e) {}
    lsSet(K.migrated, "1");
  }
}
const save = () => lsSet(K.done, JSON.stringify(done));

/* ---------- modules ---------- */
WFC.defineModule = function (id, def) {
  def.id = id;
  if (def.kind === "warframes" || def.kind === "weapons") { def.items = (def.items || []).map(a => ({ ...a, key: id + "|" + a.id, g: a.category || a.g || "items", wiki: a.wiki || a.name })); def.groups = def.groups || [{ id: "items", title: { en: "Items" } }]; }
  else def.items = def.items.map(a => ({ key: id + "|" + a[0] + ":" + a[1], g: a[0], name: a[1], desc: a[2] || "", files: a[3] || [], wiki: a[4] || a[1] }));
  WFC.mods[id] = def;
  if (typeof WFC.refresh === "function") WFC.refresh();
};
const modTitle = m => (m.title && (m.title[lang] || m.title.en)) ||
  (s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())(m.id.replace(/^\d{2}/, ""));
const stats = m => m.kind === "warframes" ? { t: m.items.length, d: m.items.filter(f => (f.parts || []).length === 3 && f.parts.every(p => done[f.key + ":" + p.id])).length } : { t: m.items.length, d: m.items.filter(i => done[i.key]).length };
const itemDone = (m, i) => m.kind === "warframes" ? (i.parts || []).every(p => done[i.key + ":" + p.id]) : !!done[i.key];
function totals() {
  return Object.values(WFC.mods).reduce((a, m) => { const s = stats(m); a.t += s.t; a.d += s.d; return a; }, { t: 0, d: 0 });
}
const pct = (d, t) => (t ? Number(((d / t) * 100).toFixed(1)) : 0);

/* ---------- images (Wiki) ---------- */
const wikiPage = n => "https://wiki.warframe.com/w/" + encodeURIComponent(n.replace(/ /g, "_"));
const wikiFile = f => "https://wiki.warframe.com/w/Special:Redirect/file/" + encodeURIComponent(f) + "?width=640";
const apiCache = new Map();
async function apiImages(title) {
  if (apiCache.has(title)) return apiCache.get(title);
  const out = [];
  for (const api of ["https://wiki.warframe.com/api.php", "https://wiki.warframe.com/w/api.php"]) {
    try {
      const u = `${api}?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=800&titles=${encodeURIComponent(title + "|" + title + " (Quest)")}`;
      const r = await fetch(u); if (!r.ok) continue;
      const j = await r.json();
      Object.values((j.query && j.query.pages) || {}).forEach(p => { if (p.thumbnail) out.push(p.thumbnail.source); });
      if (out.length) break;
    } catch (e) {}
  }
  apiCache.set(title, out); return out;
}
function fallbackSvg(name) {
  const ini = esc(name.split(/\s+/).map(x => x[0]).slice(0, 3).join(""));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#344b64"/><stop offset="1" stop-color="#101722"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><path d="M0 380L260 190l110 90 150-150 280 250v70H0z" fill="#0a111b" opacity=".55"/><text x="40" y="300" fill="#e7c47d" font-family="Arial" font-size="110" font-weight="bold">${ini}</text><text x="44" y="360" fill="#eaf0f8" font-family="Arial" font-size="28">${esc(name)}</text></svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
function loadImg(img, name, files, page) {
  const fb = fallbackSvg(name); let q = files.map(wikiFile), api = false;
  const next = async () => {
    if (!q.length && !api && navigator.onLine !== false) { api = true; q = (await apiImages(page || name)).slice(); }
    if (!q.length) { img.onerror = img.onload = null; img.src = fb; return; }
    img.src = q.shift();
  };
  img.alt = name; img.loading = "lazy";
  img.onerror = next; img.onload = () => { if (img.naturalWidth < 60) next(); };
  next();
}

/* ---------- top bar, backup, back-to-top ---------- */
function buildTop() {
  const h = $("#topbar");
  h.className = "top";
  h.innerHTML = `<nav class="nav"><a class="brand" href="${WFC.root}index.html" data-i18n="siteTitle"></a>
    <button class="btn" id="bExp" data-i18n="exp"></button>
    <button class="btn" id="bImp" data-i18n="imp"></button><input type="file" id="fImp" accept=".json,application/json" hidden>
    <label class="lang-box"><span data-i18n="language"></span><select id="sLang"></select></label></nav>`;
  const s = $("#sLang");
  LANGS.forEach(([c, n]) => s.add(new Option(n, c)));
  s.onchange = () => setLang(s.value);
  $("#bExp").onclick = exportProgress;
  $("#bImp").onclick = () => $("#fImp").click();
  $("#fImp").onchange = e => { const f = e.target.files[0]; if (f) importProgress(f); e.target.value = ""; };
  const b = document.createElement("button");
  b.id = "toTop"; b.className = "btn"; b.textContent = "↑"; b.onclick = () => scrollTo({ top: 0, behavior: "smooth" });
  document.body.appendChild(b);
  addEventListener("scroll", () => b.classList.toggle("show", scrollY > 500), { passive: true });
}
function updateTopTitle() {
  const tt = $("#toTop"); if (tt) tt.title = t("top");
}
function setLang(c) {
  lang = I[c] ? c : "en"; lsSet(K.lang, lang);
  document.documentElement.lang = lang;
  $("#sLang").value = lang;
  applyI18n(); updateTopTitle(); rerender();
}
function exportProgress() {
  const data = { app: "warframe-checklist", version: 2, exported: new Date().toISOString(), lang, done };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = "warframe-checklist-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importProgress(file) {
  const r = new FileReader();
  r.onload = () => {
    let d;
    try {
      d = JSON.parse(r.result);
      const ok = d && d.app === "warframe-checklist" && d.done && typeof d.done === "object" && !Array.isArray(d.done) &&
        Object.entries(d.done).every(([k, v]) => v === true && k.length < 300) &&
        (d.lang === undefined || !!I[d.lang]);
      if (!ok) throw 0;
    } catch (e) { alert(t("impBad")); return; }
    if (!confirm(t("impConf"))) return;
    done = { ...done, ...d.done }; save();
    if (d.lang) { lang = d.lang; lsSet(K.lang, lang); }
    setLang(lang); alert(t("impOk"));
  };
  r.readAsText(file);
}


function partIcon(partId, isPrime) {
  const color = isPrime ? "#e6c477" : "#9eb5ca";
  const bg = isPrime ? "#3a3020" : "#202d3b";
  const shapes = {
    neuroptics: '<path d="M20 8l5-4 5 4 3 9-8 5-8-5z"/><path d="M17 14h16M20 8l5 13M30 8l-5 13"/>',
    chassis: '<path d="M20 4h10l4 7-4 6v14H20V17l-4-6z"/><path d="M20 17h10M20 24h10M16 11h18"/>',
    systems: '<rect x="16" y="7" width="18" height="24" rx="3"/><path d="M20 12h10M20 18h10M20 24h5M12 13h4m18 0h4M12 25h4m18 0h4"/>'
  };
  return '<span class="wf-part-icon'+(isPrime?' prime':'')+'" aria-hidden="true"><svg viewBox="0 0 50 40" focusable="false"><g fill="none" stroke="'+color+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(shapes[partId]||shapes.chassis)+'</g><path d="M3 35h44" stroke="'+color+'" opacity=".35"/></svg><i style="background:'+bg+'"></i></span>';
}
function renderWarframesModule(host, id, focusKey) {
  const m=WFC.mods[id]; if(!m)return;
  let q="", filter="all", view=VIEWS.some(v=>v[0]===lsGet(K.view))?lsGet(K.view):"m";
  const openFrames=new Set();
  if(focusKey){const focused=m.items.find(f=>f.key===focusKey||f.id===focusKey);if(focused)openFrames.add(focused.id);}
  document.title=modTitle(m)+" — "+t("siteTitle");
  const back=WFC.spa?"#":WFC.root+"index.html";
  host.innerHTML='<div class="mhead"><a class="btn" href="'+back+'">'+esc(t("lobby"))+'</a><h1>'+esc(modTitle(m))+'</h1><span class="stat" id="wfStat"></span></div><div class="bar"><i id="wfBar"></i></div><div class="tools-block"><div class="search-row wf-tools-row"><input class="search" id="wfSearch" type="search" placeholder="'+esc(t("msearch"))+'"><div class="filter-group"><button class="btn on" data-wf-filter="all">'+esc(t("fAll"))+'</button><button class="btn" data-wf-filter="done">'+esc(t("fDone"))+'</button><button class="btn" data-wf-filter="pend">'+esc(t("fPend"))+'</button></div><label class="mark-all-box wf-mark-all"><input type="checkbox" id="wfMarkAll" data-wf-all><span>'+esc(t("markAllCb"))+'</span></label></div></div><div class="vrow module-view-row" id="wfViewRow"></div><div class="wf-grid" id="wfGrid"></div><p class="subtle" id="wfNoResults" hidden></p><div class="foot">'+esc(t("save"))+'</div>';
  const grid=host.querySelector("#wfGrid");
  grid.classList.add("v-"+view);
  const viewRow=host.querySelector("#wfViewRow");
  const drawViews=()=>{viewRow.innerHTML="";VIEWS.forEach(([k,l])=>{const b=document.createElement("button");b.className="btn"+(k===view?" on":"");b.dataset.view=k;b.setAttribute("aria-pressed",String(k===view));b.innerHTML=svg(k)+" "+esc(t(l));viewRow.appendChild(b);});};
  viewRow.onclick=e=>{const b=e.target.closest("[data-view]");if(!b)return;view=b.dataset.view;lsSet(K.view,view);grid.className="wf-grid v-"+view;drawViews();};
  drawViews();
  const cards=new Map();
  function makeCard(f) {
    const card=document.createElement("article");
    card.className="wf-card";
    card.dataset.wfId=f.id;
    const parts=(f.parts||[]).map(part=>{
      const drops=part.drops||[];
      const dropHtml=drops.length?drops.map(drop=>'<div class="wf-drop"><span>'+esc(drop.source)+'</span><strong>'+(drop.chance==null?esc(t("wfChanceUnknown")):esc(String(drop.chance).replace(".",",")+"%"))+'</strong>'+(drop.detail?'<small>'+esc(drop.detail)+'</small>':"")+'<a href="'+esc(drop.sourceUrl||f.wikiUrl||wikiPage(f.name))+'" target="_blank" rel="noopener">'+esc(t("wfSource"))+'</a></div>').join(""):'<div class="wf-drop wf-unknown">'+esc(t("wfNoDrop"))+'</div>';
      return '<section class="wf-part" data-part-id="'+esc(part.id)+'"><div class="wf-part-title">'+(part.image?'<img class="wf-part-image" src="'+esc(part.image)+'" alt="'+esc(part.label)+'" loading="lazy">':'')+'<span>'+esc(part.label)+(f.isPrime?' <small class="wf-prime-tag">PRIME</small>':"")+'</span></div><div class="wf-drops'+(drops.length>3?' has-many':'')+'">'+dropHtml+'</div><label class="wf-check"><input type="checkbox" data-part="'+esc(f.key+":"+part.id)+'"><span>'+esc(t("check"))+'</span></label></section>';
    }).join("");
    card.innerHTML='<div class="wf-head"><button type="button" class="wf-expander" data-expand="'+esc(f.id)+'" aria-expanded="false"><img class="wf-image" alt="'+esc(f.name)+'" loading="lazy"><span class="wf-title"><span class="wf-name-line"><strong>'+esc(f.name)+'</strong><a class="wf-wiki" href="'+esc(f.wikiUrl||wikiPage(f.name))+'" target="_blank" rel="noopener" aria-label="'+esc(t("wiki"))+'">↗ '+esc(t("wiki"))+'</a></span><small class="wf-count"></small><span class="bar sm"><i></i></span></span><span class="wf-chevron" aria-hidden="true">›</span></button><label class="wf-master-check" title="'+esc(t("check"))+'"><input type="checkbox" data-frame="'+esc(f.id)+'" aria-label="'+esc(t("check"))+' '+esc(f.name)+'"><span></span></label></div><div class="wf-parts" hidden>'+parts+'</div>';
    const img=card.querySelector(".wf-image");
    const imageUrl=f.image||"";
    if(imageUrl && img.dataset.src!==imageUrl){img.dataset.src=imageUrl;img.src=imageUrl;}
    img.onerror=()=>{img.classList.add("image-failed");img.removeAttribute("src");};
    card.querySelector("[data-expand]").onclick=()=>{
      const key=f.id;
      if(openFrames.has(key))openFrames.delete(key);else openFrames.add(key);
      updateCard(f,card);
    };
    card.querySelector('input[data-frame]').onchange=e=>{
      const checked=e.currentTarget.checked;
      f.parts.forEach(part=>{const key=f.key+":"+part.id;if(checked)done[key]=true;else delete done[key];});
      save();render();
    };
    card.querySelectorAll("input[data-part]").forEach(cb=>cb.onchange=()=>{
      if(cb.checked)done[cb.dataset.part]=true;else delete done[cb.dataset.part];
      save();render();
    });
    return card;
  }
  function updateCard(f,card) {
    const d=(f.parts||[]).filter(part=>done[f.key+":"+part.id]).length;
    const fp=Math.round(d/3*100),opened=openFrames.has(f.id);
    card.classList.toggle("done",d===3);
    card.classList.toggle("expanded",opened);
    const btn=card.querySelector("[data-expand]");
    btn.setAttribute("aria-expanded",String(opened));
    card.querySelector(".wf-parts").hidden=!opened;
    card.querySelector(".wf-count").textContent=d+"/3 · "+fp+"%";
    card.querySelector(".wf-title .bar i").style.width=fp+"%";
    const master=card.querySelector('input[data-frame]');
    master.checked=d===3;
    card.querySelectorAll("input[data-part]").forEach(cb=>{cb.checked=!!done[cb.dataset.part];});
  }
  m.items.forEach(f=>{
    const card=makeCard(f);
    cards.set(f.id,card);
    grid.appendChild(card);
  });
  function render(){
    const s=stats(m),p=pct(s.d,s.t),nq=norm(q);
    host.querySelector("#wfStat").textContent=t("cDone",{d:s.d,t:s.t})+" · "+p+"%";
    host.querySelector("#wfBar").style.width=p+"%";
    host.querySelectorAll("[data-wf-filter]").forEach(b=>b.classList.toggle("on",b.dataset.wfFilter===filter));
    let visible=0;
    m.items.forEach(f=>{
      const card=cards.get(f.id);
      const d=(f.parts||[]).filter(part=>done[f.key+":"+part.id]).length;
      const matches=(filter==="all"||(filter==="done"&&d===3)||(filter==="pend"&&d<3))&&(!nq||norm(f.name).includes(nq));
      card.hidden=!matches;
      if(matches)visible++;
      updateCard(f,card);
    });
    const empty=host.querySelector("#wfNoResults");
    empty.hidden=visible>0;
    empty.textContent=t("noRes");
    const allParts=m.items.flatMap(f=>(f.parts||[]).map(part=>f.key+":"+part.id));
    const checked=allParts.filter(key=>done[key]).length;
    const allBox=host.querySelector("#wfMarkAll");
    if(allBox){allBox.checked=allParts.length>0&&checked===allParts.length;allBox.indeterminate=checked>0&&checked<allParts.length;}
  }
  const allBox=host.querySelector("#wfMarkAll");
  if(allBox)allBox.onchange=()=>{
    const keys=m.items.flatMap(f=>(f.parts||[]).map(part=>f.key+":"+part.id));
    const any=keys.some(key=>done[key]);
    if(confirm(t(any?"confUnmarkAll":"confMarkAll"))){keys.forEach(key=>{if(any)delete done[key];else done[key]=true;});save();}
    render();
  };
  host.querySelector("#wfSearch").oninput=e=>{q=e.target.value;render();};
  host.querySelectorAll("[data-wf-filter]").forEach(b=>b.onclick=()=>{filter=b.dataset.wfFilter;render();});
  render();
}


function renderWeaponsModule(host, id, focusKey) {
  const m=WFC.mods[id]; if(!m)return;
  let q="", category="primary", completion="all", view=VIEWS.some(v=>v[0]===lsGet(K.view))?lsGet(K.view):"m";
  const categories=[["primary","Primary","Primárias"],["secondary","Secondary","Secundárias"],["melee","Melee","Melee"]];
  document.title=modTitle(m)+" — "+t("siteTitle");
  const back=WFC.spa?"#":WFC.root+"index.html";
  host.innerHTML='<div class="mhead"><a class="btn" href="'+back+'">'+esc(t("lobby"))+'</a><h1>'+esc(modTitle(m))+'</h1><div class="wep-category-tabs" id="wepTabs"></div><span class="stat" id="wepStat"></span></div><div class="bar"><i id="wepBar"></i></div><div class="tools-block"><div class="search-row wf-tools-row"><input class="search" id="wepSearch" type="search" placeholder="'+esc(t("msearch"))+'"><div class="filter-group"><button class="btn on" data-completion="all">'+esc(t("fAll"))+'</button><button class="btn" data-completion="done">'+esc(t("fDone"))+'</button><button class="btn" data-completion="pending">'+esc(t("fPend"))+'</button></div><label class="mark-all-box wf-mark-all"><input type="checkbox" id="wepMarkAll"><span>'+esc(t("markAllCb"))+'</span></label></div></div><div class="vrow module-view-row" id="wepViewRow"></div><div class="wf-grid" id="wepGrid"></div><p class="subtle" id="wepNoResults" hidden></p><div class="foot">'+esc(t("save"))+'</div>';
  const grid=host.querySelector("#wepGrid"),tabs=host.querySelector("#wepTabs"),viewRow=host.querySelector("#wepViewRow");
  const items=m.items,cards=new Map();
  const currentItems=()=>items.filter(i=>i.category===category);
  function drawTabs(){tabs.innerHTML=categories.map(([id,en,pt])=>'<button class="btn'+(id===category?' on':'')+'" data-category="'+id+'">'+(lang==="pt"?pt:en)+'</button>').join("");}
  function drawViews(){viewRow.innerHTML="";VIEWS.forEach(([k,l])=>{const b=document.createElement("button");b.className="btn"+(k===view?" on":"");b.dataset.view=k;b.innerHTML=svg(k)+" "+esc(t(l));viewRow.appendChild(b);});}
  function dropRows(drops,weaponName){
    return Array.isArray(drops)&&drops.length?drops.map(d=>'<div class="wf-drop"><span>'+esc(d.source||"Fonte não identificada")+'</span><strong>'+(d.chance==null?esc(t("wfChanceUnknown")):esc(String(d.chance).replace(".",",")+"%"))+'</strong>'+(d.detail?'<small>'+esc(d.detail)+'</small>':"")+'<a href="'+esc(d.sourceUrl||wikiPage(weaponName))+'" target="_blank" rel="noopener">'+esc(t("wfSource"))+'</a></div>').join(""):'<div class="wf-drop wf-unknown">'+esc(t("wfNoDrop"))+'</div>';
  }
  function makeCard(item){
    const c=document.createElement("article");c.className="wf-card weapon-card";c.dataset.weapon=item.id;
    const parts=Array.isArray(item.parts)?item.parts:[];
    const partHtml=parts.length?parts.map((part,index)=>'<section class="wf-part"><div class="wf-part-title"><img class="wf-part-image" data-part-image="'+index+'" alt="'+esc(part.name)+'" loading="lazy"><span>'+esc(part.name)+(part.count>1?' ×'+esc(part.count):"")+'</span></div><a class="wf-part-wiki" href="'+esc(part.wikiUrl||item.wikiUrl||wikiPage(item.name))+'" target="_blank" rel="noopener">'+esc(t("wiki"))+'</a><div class="wf-drops'+((part.drops||[]).length>3?' has-many':'')+'">'+dropRows(part.drops,item.name)+'</div></section>').join(""):'<div class="wf-drop wf-unknown">'+(lang==="pt"?"Peças individuais não identificadas na fonte.":"Individual parts not listed in the source.")+'</div>';
    const blueprint='<section class="wf-part"><div class="wf-part-title">'+(lang==="pt"?"Projeto da arma":"Weapon Blueprint")+'</div><div class="wf-drops'+((item.drops||[]).length>3?' has-many':'')+'">'+dropRows(item.drops,item.name)+'</div></section>';
    c.innerHTML='<div class="wf-head"><button type="button" class="wf-expander" data-expand="'+esc(item.id)+'" aria-expanded="false"><img class="wf-image" alt="'+esc(item.name)+'" loading="lazy"><span class="wf-title"><span class="wf-name-line"><strong>'+esc(item.name)+'</strong><a class="wf-wiki" href="'+esc(item.wikiUrl||wikiPage(item.name))+'" target="_blank" rel="noopener" aria-label="'+esc(t("wiki"))+'">↗ '+esc(t("wiki"))+'</a></span><small class="wf-count">'+(item.variant?esc(item.variant):"")+'</small><span class="bar sm"><i></i></span></span><span class="wf-chevron" aria-hidden="true">›</span></button><label class="wf-master-check" title="'+esc(t("check"))+'"><input type="checkbox" data-weapon="'+esc(item.key)+'" aria-label="'+esc(t("check"))+' '+esc(item.name)+'"><span></span></label></div><div class="wf-parts weapon-parts" hidden>'+blueprint+partHtml+'</div>';
    const img=c.querySelector(".wf-image");
    if(item.image){img.src=item.image;img.onerror=()=>loadImg(img,item.name,[],item.name);}else loadImg(img,item.name,[],item.name);
    c.querySelectorAll("[data-part-image]").forEach(el=>{
      const part=parts[Number(el.dataset.partImage)];
      if(part.image){el.src=part.image;el.onerror=()=>loadImg(el,part.name,[],part.name);}else loadImg(el,part.name,[],part.name);
    });
    c.querySelector("[data-expand]").onclick=()=>{
      c.classList.toggle("expanded");
      const opened=c.classList.contains("expanded"),btn=c.querySelector("[data-expand]");
      btn.setAttribute("aria-expanded",String(opened));
      c.querySelector(".weapon-parts").hidden=!opened;
    };
    c.querySelector("[data-weapon]").onchange=e=>{if(e.currentTarget.checked)done[item.key]=true;else delete done[item.key];save();refresh();};
    cards.set(item.id,c);return c;
  }
  items.forEach(i=>grid.appendChild(makeCard(i)));
  function refresh(){
    const s=stats(m),p=pct(s.d,s.t),nq=norm(q),scope=currentItems();
    host.querySelector("#wepStat").textContent=t("cDone",{d:s.d,t:s.t})+" · "+p+"%";
    host.querySelector("#wepBar").style.width=p+"%";
    host.querySelectorAll("[data-completion]").forEach(b=>b.classList.toggle("on",b.dataset.completion===completion));
    let visible=0;
    items.forEach(i=>{
      const c=cards.get(i.id),isDone=!!done[i.key];
      const matches=i.category===category&&(completion==="all"||(completion==="done"&&isDone)||(completion==="pending"&&!isDone))&&(!nq||norm(i.name).includes(nq));
      c.hidden=!matches;if(matches)visible++;
      c.classList.toggle("done",isDone);c.querySelector("[data-weapon]").checked=isDone;
      c.querySelector(".wf-title .bar i").style.width=(isDone?100:0)+"%";
    });
    host.querySelector("#wepNoResults").hidden=visible>0;
    const keys=scope.map(i=>i.key),count=keys.filter(k=>done[k]).length,box=host.querySelector("#wepMarkAll");
    box.checked=keys.length>0&&count===keys.length;box.indeterminate=count>0&&count<keys.length;
  }
  tabs.onclick=e=>{const b=e.target.closest("[data-category]");if(!b)return;category=b.dataset.category;drawTabs();refresh();};
  viewRow.onclick=e=>{const b=e.target.closest("[data-view]");if(!b)return;view=b.dataset.view;lsSet(K.view,view);grid.className="wf-grid v-"+view;drawViews();};
  host.querySelector("#wepSearch").oninput=e=>{q=e.target.value;refresh();};
  host.querySelectorAll("[data-completion]").forEach(b=>b.onclick=()=>{completion=b.dataset.completion;refresh();});
  host.querySelector("#wepMarkAll").onchange=()=>{
    const keys=currentItems().map(i=>i.key),any=keys.some(k=>done[k]);
    if(confirm(t(any?"confUnmarkAll":"confMarkAll"))){keys.forEach(k=>{if(any)delete done[k];else done[k]=true;});save();}
    refresh();
  };
  grid.className="wf-grid v-"+view;drawTabs();drawViews();refresh();
}

/* ---------- Module view ---------- */
function renderModule(host, id, focusKey) {
  const m = WFC.mods[id]; if (!m) return;
  if (m.kind === "warframes") return renderWarframesModule(host, id, focusKey);
  if (m.kind === "weapons") return renderWeaponsModule(host, id, focusKey);
  let q = "", view = VIEWS.some(v => v[0] === lsGet(K.view)) ? lsGet(K.view) : "m";
  const groups = m.groups || [{ id: m.items[0] && m.items[0].g }];
  const groupFilters = {};
  let activeGroup = groups[0]?.id || "", journeyOrder = lsGet("wfc.journey.order") || "codex";
  const communityQuestOrder = ["Awakening","Vor's Prize","The Teacher","Vox Solaris","Once Awake","Heart of Deimos","The Archwing","The Duviri Paradox","Natah","The Second Dream","The War Within","Rising Tide","Chains of Harrow","Apostasy Prologue","The Sacrifice","Chimera Prologue","Erra","The Maker","Prelude to War","The New War","Whispers in the Walls","The Lotus Eaters","The Hex","The Old Peace","Prologue to Tau","Saya's Vigil","Howl of the Kubrow","Stolen Dreams","The New Strange","The Deadlock Protocol","Call of the Tempestarii","The Glast Gambit","Octavia's Anthem","Sands of Inaros","Hidden Messages","Mask of the Revenant","The Silver Grove","The Waverider","The Limbo Theorem","The Jordas Precept","Patient Zero","A Man of Few Words","Jade Shadows","Jade Shadows: Constellations","Angels of the Zariman","Veilbreaker"];
  groups.forEach(g => { groupFilters[g.id] = "all"; });
  if (focusKey) { const targetItem = m.items.find(it => it.key === focusKey); if (targetItem) activeGroup = targetItem.g; }
  document.title = modTitle(m) + " — " + t("siteTitle");
  const back = WFC.spa ? "#" : WFC.root + "index.html";
  host.innerHTML = `<div class="mhead"><a class="btn" href="${back}">${esc(t("lobby"))}</a><h1>${esc(modTitle(m))}</h1><div class="journey-category-tabs" id="journeyTabs"></div><span class="stat" id="mStat"></span></div>
    <div class="bar"><i id="mBar"></i></div><div class="banner hidden" id="mBan">${esc(t("modDone"))}</div>
    <div class="tools-block"><div class="search-row wf-tools-row"><input class="search" type="search" placeholder="${esc(t("msearch"))}">
      <label class="mark-all-box" for="chkMarkAll"><input type="checkbox" id="chkMarkAll" data-ma="*"><span>${esc(t("markAllCb"))}</span></label>
    </div></div><div class="vrow module-view-row" id="moduleViewRow"></div>
    <div class="journey-groups" id="journeyGroups">${groups.map(g => `<section class="journey-group" data-g="${esc(g.id)}">
      <div class="journey-group-head"><h2>${esc(g.title ? (g.title[lang] || g.title.en) : "")}</h2><span class="gs"></span></div>
      <div class="sec-filters" data-sg="${esc(g.id)}"><button class="btn on" data-sf="all">${esc(t("fAll"))}</button><button class="btn" data-sf="done">${esc(t("fDone"))}</button><button class="btn" data-sf="pend">${esc(t("fPend"))}</button>
        <label class="mark-all-box"><input type="checkbox" data-ma="${esc(g.id)}"><span>${esc(t("markAllCb"))}</span></label></div><div class="grid module-grid v-${view}"></div>
    </section>`).join("")}</div>`;
  const tabs = host.querySelector("#journeyTabs"), moduleViewRow = host.querySelector("#moduleViewRow");
  const drawTabs = () => { tabs.innerHTML = groups.map(g => {
    const title = g.title ? (g.title[lang] || g.title.en) : g.id, count = m.items.filter(i => i.g === g.id).length;
    return '<button class="btn'+(g.id===activeGroup?' on':'')+'" data-group="'+esc(g.id)+'">'+esc(title)+' <small>('+count+')</small></button>';
  }).join(""); };
  const drawModuleViews = () => { moduleViewRow.innerHTML = ""; VIEWS.forEach(([k,l]) => { const b=document.createElement("button"); b.className="btn"+(k===view?" on":""); b.dataset.view=k; b.setAttribute("aria-pressed",String(k===view)); b.innerHTML=svg(k)+" "+esc(t(l)); moduleViewRow.appendChild(b); }); };
  tabs.onclick = e => { const b=e.target.closest("[data-group]"); if(!b)return; activeGroup=b.dataset.group; drawTabs(); refresh(); };
  moduleViewRow.onclick = e => { const b=e.target.closest("[data-view]"); if(!b)return; view=b.dataset.view; lsSet(K.view,view); host.querySelectorAll(".module-grid").forEach(g=>g.className="grid module-grid v-"+view); drawModuleViews(); };
  drawTabs(); drawModuleViews();
  if (id === "01JOURNEYS") {
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "btn journey-order-toggle";
    const drawToggle = () => { toggle.textContent = journeyOrder === "community" ? "⇅ Comunidade" : "⇅ Codex"; toggle.setAttribute("aria-pressed", String(journeyOrder === "community")); };
    drawToggle(); host.querySelector(".search-row").insertBefore(toggle, host.querySelector("#chkMarkAll").closest("label"));
    toggle.onclick = () => { journeyOrder = journeyOrder === "codex" ? "community" : "codex"; lsSet("wfc.journey.order", journeyOrder); rerender(); };
  }
  const cards = [], displayItems = id === "01JOURNEYS" && journeyOrder === "community" ? [...m.items].sort((a,b) => {
    const ai=communityQuestOrder.indexOf(a.name), bi=communityQuestOrder.indexOf(b.name);
    return (ai<0?999:ai)-(bi<0?999:bi) || m.items.indexOf(a)-m.items.indexOf(b);
  }) : m.items;
  displayItems.forEach(it => {
    const sec = host.querySelector(`section[data-g="${CSS.escape(it.g)}"]`) || host.querySelector("section.journey-group"), descText = tpl(it.desc).trim();
    const c = document.createElement("article"); c.className = "card"; c.dataset.key = it.key;
    c.innerHTML = `<div class="art"><img></div><div class="body"><h3>${esc(it.name)}</h3>${descText ? `<div class="desc">${esc(descText)}</div>` : ""}
      <div class="row"><button class="chk" aria-pressed="false">${esc(t("check"))}</button><a class="wiki" target="_blank" rel="noopener" href="${wikiPage(it.wiki)}">${esc(t("wiki"))}</a></div></div>`;
    loadImg(c.querySelector("img"), it.name, it.files);
    c.querySelector(".chk").onclick = () => { done[it.key] ? delete done[it.key] : (done[it.key] = true); save(); refresh(); };
    sec.querySelector(".grid").appendChild(c); cards.push([it, c]);
  });
  const scopeItems = g => (g === "*" ? m.items : m.items.filter(i => i.g === g));
  function refresh() {
    const s = stats(m), nq = norm(q);
    cards.forEach(([it, c]) => {
      const d = !!done[it.key], sf = groupFilters[it.g] || "all";
      c.classList.toggle("done", d); c.querySelector(".chk").setAttribute("aria-pressed", d);
      const matchGroup = sf === "all" || (sf === "done" && d) || (sf === "pend" && !d), matchSearch = !nq || norm(it.name).includes(nq);
      c.classList.toggle("hidden", !(it.g === activeGroup && matchGroup && matchSearch));
    });
    host.querySelectorAll(".journey-group").forEach(sec => {
      const gid = sec.dataset.g, its = m.items.filter(i => i.g === gid), d = its.filter(i => done[i.key]).length;
      sec.querySelector(".gs").textContent = t("cDone", { d, t: its.length }); sec.hidden = gid !== activeGroup;
      sec.querySelectorAll("[data-sf]").forEach(b => b.classList.toggle("on", b.dataset.sf === (groupFilters[gid] || "all")));
    });
    host.querySelector("#mStat").textContent = t("cDone", { d: s.d, t: s.t }); host.querySelector("#mBar").style.width = pct(s.d, s.t) + "%";
    host.querySelector("#mBan").classList.toggle("hidden", !(s.t && s.d === s.t));
    host.querySelectorAll("input[data-ma]").forEach(cb => { const its = scopeItems(cb.dataset.ma), d = its.filter(i => done[i.key]).length; cb.checked = its.length > 0 && d === its.length; cb.indeterminate = d > 0 && d < its.length; });
  }
  host.querySelectorAll(".sec-filters").forEach(bar => { const gid = bar.dataset.sg; bar.querySelectorAll("[data-sf]").forEach(b => b.onclick = () => { groupFilters[gid] = b.dataset.sf; refresh(); }); });
  host.querySelector(".search").oninput = e => { q = e.target.value; const nq = norm(q); if (nq) { const match = groups.find(g => m.items.some(it => it.g === g.id && norm(it.name).includes(nq))); if (match) { activeGroup = match.id; drawTabs(); } } refresh(); };
  host.querySelectorAll("input[data-ma]").forEach(cb => cb.onchange = () => {
    const its = scopeItems(cb.dataset.ma), any = its.some(i => done[i.key]);
    if (confirm(t(any ? "confUnmarkAll" : "confMarkAll"))) { its.forEach(i => { if (any) delete done[i.key]; else done[i.key] = true; }); save(); }
    refresh();
  });
  refresh();
  if (focusKey) { const hit = cards.find(([it]) => it.key === focusKey); if (hit) setTimeout(() => { hit[1].scrollIntoView({ block: "center" }); hit[1].classList.add("flash"); }, 150); }
  else scrollTo(0, 0);
}
/* ---------- Lobby view ---------- */
const ICO = {
  xl: '<rect x="2" y="2" width="12" height="9" rx="1"/><path d="M6 14h4"/>',
  l: '<rect x="3" y="3" width="10" height="7" rx="1"/><path d="M6 13h4M8 10v3"/>',
  m: '<rect x="4" y="4" width="8" height="6" rx="1"/><path d="M6 13h4M8 10v3"/>',
  s: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  list: '<path d="M2 4h2M6 4h8M2 8h2M6 8h8M2 12h2M6 12h8"/>',
  det: '<path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12"/>',
  tiles: '<rect x="2" y="2" width="4" height="4"/><path d="M8 3h6M8 5h4"/><rect x="2" y="9" width="4" height="4"/><path d="M8 10h6M8 12h4"/>',
  cont: '<rect x="2" y="2" width="3" height="3"/><path d="M7 3.5h7"/><rect x="2" y="7" width="3" height="3"/><path d="M7 8.5h7M2 13h12"/>'
};
const VIEWS = [["s", "vS"], ["m", "vM"], ["l", "vL"], ["det", "vDet"], ["tiles", "vTiles"]];
const svg = k => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${ICO[k]}</svg>`;
function renderLobby(host) {
  document.title = t("siteTitle");
  const T = totals(), p = pct(T.d, T.t), view = VIEWS.some(v => v[0] === lsGet(K.view)) ? lsGet(K.view) : "m";
  const mods = Object.values(WFC.mods).sort((a, b) => a.id.localeCompare(b.id));
  const lines = x => x.split(/(?<=[.。!?！？])\s*(?=\S)/).map(l => `<div>${esc(l)}</div>`).join("");
  host.innerHTML = `<section class="box"><h1>${esc(t("progressTitle"))}</h1><div class="about">${lines(t("about"))}</div>
    <div class="big"><b>${esc(t("pctDone", { p }))}</b><span>${esc(t("contentsDone", { d: T.d, t: T.t }))} · ${esc(t("pendingN", { n: T.t - T.d }))}</span></div>
    <div class="bar"><i style="width:${p}%"></i></div></section>
    <div class="notice"><b>${esc(t("noticeTitle"))}:</b>${lines(t("notice"))}</div>
    <h2 class="sec">${esc(t("heading"))}</h2><p class="subtle">${esc(t("sub"))}</p>
    <input class="search" id="gs" type="search" placeholder="${esc(t("gsearch"))}"><div class="results" id="gr"></div>
    <div class="vrow" id="vRow"></div>
    <div class="mods v-${view}">${mods.map(m => {
      const s = stats(m), mp = pct(s.d, s.t), full = s.t > 0 && s.d === s.t;
      return `<a class="mod ${full ? "full" : "pending"}" href="#m=${encodeURIComponent(m.id)}" data-id="${esc(m.id)}">
        <div class="img"><img><span class="tag ${full ? "d" : "p"}">${esc(full ? "✓ " + t("badgeDone") : t("badgePend", { n: s.t - s.d }))}</span></div>
        <div class="info"><h3>${esc(modTitle(m))}</h3><div class="meta"><span>${esc(t("cDone", { d: s.d, t: s.t }))}</span><span>${mp}%</span></div>
        <div class="bar sm"><i style="width:${mp}%"></i></div></div><label class="mod-check"><input type="checkbox" data-mod-check="${esc(m.id)}"><span>${esc(t("markAllCb"))}</span></label></a>`;
    }).join("")}</div>
    <div class="foot">${esc(t("save"))}</div>`;
  host.querySelectorAll(".mod").forEach(a => {
    const m = WFC.mods[a.dataset.id], c = m.cover || {};
    loadImg(a.querySelector("img"), modTitle(m), c.files || [], c.page);
    const scope = m.kind === "warframes" ? m.items.flatMap(f => (f.parts || []).map(p => f.key + ":" + p.id)) : m.items.map(i => i.key);
    const check = a.querySelector("[data-mod-check]");
    const checkedCount = scope.filter(k => done[k]).length;
    check.checked = scope.length > 0 && checkedCount === scope.length; check.indeterminate = checkedCount > 0 && checkedCount < scope.length;
    check.onclick = e => e.stopPropagation();
    check.closest("label").onclick = e => e.stopPropagation();
    check.onchange = () => { const any = scope.some(k => done[k]); if (confirm(t(any ? "confUnmarkAll" : "confMarkAll"))) { scope.forEach(k => { if (any) delete done[k]; else done[k] = true; }); save(); } rerender(); };
  });
  const vr = $("#vRow"), grid = $(".mods");
  const drawView = () => {
    const cur = [...grid.classList].find(c => c.startsWith("v-")).slice(2);
    vr.innerHTML = VIEWS.map(([k, l]) => `<button class="btn${k === cur ? " on" : ""}" data-v="${k}" aria-pressed="${k === cur}">${svg(k)} ${esc(t(l))}</button>`).join("");
  };
  vr.onclick = e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    grid.className = "mods v-" + b.dataset.v; lsSet(K.view, b.dataset.v); drawView();
  };
  drawView();
  const gs = $("#gs"), gr = $("#gr");
  gs.oninput = () => {
    const q = norm(gs.value.trim()); if (!q) { gr.innerHTML = ""; return; }
    const hits = [];
    mods.forEach(m => m.items.forEach(i => { if (norm(i.name).includes(q) || norm(i.wiki).includes(q)) hits.push([m, i]); }));
    gr.innerHTML = hits.length ? hits.slice(0, 30).map(([m, i]) => {
      const g = (m.groups || []).find(x => x.id === i.g);
      return `<a class="res" href="#m=${encodeURIComponent(m.id)}&i=${encodeURIComponent(i.key)}"><span>${itemDone(m, i) ? '<span class="ok">✓</span> ' : ""}${esc(i.name)}</span>
        <small>${esc(t("inMod"))} ${esc(modTitle(m))}${g && g.title ? " · " + esc(g.title[lang] || g.title.en) : ""}</small></a>`;
    }).join("") : `<small class="subtle">${esc(t("noRes"))}</small>`;
  };
}

/* ---------- boot ---------- */
const loadScript = src => new Promise(res => { const s = document.createElement("script"); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
async function discover() {
  const names = new Set(W.WFC_MANIFEST || []);
  if (location.protocol !== "file:") try {                // when served over http, also auto-detect new files in Content/
    const r = await fetch(WFC.root + "Content/");
    if (r.ok) [...(await r.text()).matchAll(/href="([^"?#]+?\.html)"/gi)].forEach(m => names.add(decodeURIComponent(m[1]).split("/").pop()));
  } catch (e) {}
  return [...names].filter(n => /^\d{2}.+\.html$/i.test(n)).sort();
}
WFC.boot = async function (opt) {
  load(); buildTop();
  WFC.refresh = () => rerender();
  const host = $("#app"); host.textContent = t("loading");
  document.documentElement.lang = lang; $("#sLang").value = lang; applyI18n(); updateTopTitle();
  if (opt.page === "module") {
    rerender = () => renderModule(host, opt.id);
    rerender();
  } else {
    WFC.spa = true;
    const files = await discover();
    await Promise.all(files.map(async f => { const id = f.replace(/\.html$/i, ""); if (WFC.mods[id]) return 0; if (id === "02WARFRAMES") await loadScript(`${WFC.root}Content/warframes-data.js`); if (id === "03WEAPONS") await loadScript(`${WFC.root}Content/weapons-data.js`); return loadScript(`${WFC.root}Content/${id}.js`); }));
    const route = () => {
      const h = new URLSearchParams(location.hash.slice(1)), id = h.get("m");
      if (id && WFC.mods[id]) rerender = () => renderModule(host, id, null), renderModule(host, id, h.get("i"));
      else { rerender = () => renderLobby(host); renderLobby(host); scrollTo(0, 0); }
    };
    addEventListener("hashchange", route);
    addEventListener("storage", e => { if (e.key === K.done) { load(); rerender(); } });
    route();
  }
};
})();
