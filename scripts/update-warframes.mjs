import fs from "node:fs/promises";
import path from "node:path";

const WARFRAMES_URL = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Warframes.json";
const DROPS_URL = "https://raw.githubusercontent.com/WFCD/warframe-drop-data/main/data/all.json";
const DROP_DATA_SOURCE = "WFCD parsed data from Digital Extremes official drop tables";
const EXCLUDED = new Set(["Excalibur Prime"]);
const PARTS = [
  ["neuroptics", "Neuroptics"],
  ["chassis", "Chassis"],
  ["systems", "Systems"]
];

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "accept": "application/json", "user-agent": "Warframe-Checklist-GitHub-Actions" },
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " ao consultar " + url);
  return response.json();
}

function asArray(value, label) {
  if (!Array.isArray(value)) throw new Error("Formato inesperado: " + label + " não é uma lista.");
  return value;
}

function wikiPageUrl(title) {
  const page = String(title || "").trim().replace(/\s+/g, "_");
  return "https://wiki.warframe.com/w/" + encodeURIComponent(page || "Warframe");
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function unwrap(data, key) {
  const value = data[key];
  return value && !Array.isArray(value) && typeof value === "object" && key in value ? value[key] : value;
}

function buildDrops(itemName, data) {
  const out = [];
  const seen = new Set();
  const add = (source, chance, detail = "") => {
    const normalizedChance = asNumber(chance);
    const key = [source, normalizedChance, detail].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      source: String(source || "Fonte não identificada"),
      chance: normalizedChance,
      detail: String(detail || ""),
      sourceUrl: wikiPageUrl(String(source).split(" · ").pop())
    });
  };

  for (const entry of asArray(unwrap(data, "blueprintLocations"), "blueprintLocations")) {
    if (entry?.itemName !== itemName) continue;
    for (const enemy of entry.enemies || []) {
      const withinTable = asNumber(enemy.chance);
      const enemyTableChance = asNumber(enemy.enemyItemDropChance);
      const totalChance = withinTable !== null && enemyTableChance !== null
        ? withinTable * enemyTableChance / 100
        : withinTable;
      const detail = [
        withinTable !== null ? "Chance na tabela: " + withinTable + "%" : "",
        enemyTableChance !== null ? "Chance de drop de item: " + enemyTableChance + "%" : "",
        enemy.rarity || ""
      ].filter(Boolean).join(" · ");
      add(enemy.enemyName || "Inimigo", totalChance, detail);
    }
  }

  const missions = unwrap(data, "missionRewards") || {};
  for (const [planet, nodes] of Object.entries(missions)) {
    for (const [node, mission] of Object.entries(nodes || {})) {
      for (const [rotation, rewards] of Object.entries(mission?.rewards || {})) {
        for (const reward of Array.isArray(rewards) ? rewards : []) {
          if (reward?.itemName === itemName) {
            add(planet + " · " + node, reward.chance,
              "Rotação " + rotation + (reward.rarity ? " · " + reward.rarity : ""));
          }
        }
      }
    }
  }

  for (const relic of asArray(unwrap(data, "relics"), "relics")) {
    if (!relic) continue;
    const rewards = Array.isArray(relic.rewards)
      ? relic.rewards
      : Object.values(relic.rewards || {}).flat();
    for (const reward of rewards) {
      if (reward?.itemName === itemName) {
        add([relic.tier, relic.relicName].filter(Boolean).join(" ") || "Relíquia",
          reward.chance,
          "Refinamento " + (relic.state || "não especificado") +
          (reward.rarity ? " · " + reward.rarity : ""));
      }
    }
  }

  for (const key of ["cetusBountyRewards", "solarisBountyRewards", "deimosRewards", "zarimanRewards"]) {
    const entries = unwrap(data, key);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const [rotation, rewards] of Object.entries(entry?.rewards || {})) {
        for (const reward of Array.isArray(rewards) ? rewards : []) {
          if (reward?.itemName === itemName) {
            add(entry.bountyLevel || entry.objectiveName || key, reward.chance,
              [reward.stage || "", rotation, reward.rarity || ""].filter(Boolean).join(" · "));
          }
        }
      }
    }
  }

  const transient = unwrap(data, "transientRewards");
  if (Array.isArray(transient)) {
    for (const entry of transient) {
      const rewards = Array.isArray(entry?.rewards)
        ? entry.rewards
        : Object.values(entry?.rewards || {}).flat();
      for (const reward of rewards) {
        if (reward?.itemName === itemName) {
          add(entry.objectiveName || "Recompensa especial", reward.chance,
            reward.rarity || "");
        }
      }
    }
  }

  return out;
}

function normalizeWarframes(raw) {
  const frames = Array.isArray(raw) ? raw : raw?.Warframes;
  return asArray(frames, "Warframes.json");
}

async function wikiThumbnails(names) {
  const found = new Map();
  const unique = [...new Set(names.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 40) {
    const batch = unique.slice(i, i + 40);
    const url = "https://wiki.warframe.com/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=800&titles=" +
      encodeURIComponent(batch.join("|"));
    try {
      const response = await fetch(url, {
        headers: { "accept": "application/json", "user-agent": "Warframe-Checklist-GitHub-Actions" },
        signal: AbortSignal.timeout(45000)
      });
      if (!response.ok) throw new Error("Wiki API HTTP " + response.status);
      const json = await response.json();
      for (const page of Object.values(json.query?.pages || {})) {
        if (page.title && page.thumbnail?.source) found.set(page.title.toLowerCase(), page.thumbnail.source);
      }
    } catch (error) {
      console.warn("Não foi possível consultar miniaturas da Wiki (lote " + (i / 40 + 1) + "):", error.message);
    }
  }
  return found;
}

async function wikiComponentThumbnails(frames) {
  const filesByKey = new Map();
  const fileTitles = new Set();
  const normalizeTitle = value => String(value || "").replace(/^File:/i, "").replace(/_/g, " ").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const batches = [];
  for (let i = 0; i < frames.length; i += 30) batches.push(frames.slice(i, i + 30));
  for (const batch of batches) {
    const url = "https://wiki.warframe.com/api.php?action=query&format=json&redirects=1&prop=images&imlimit=500&titles=" +
      encodeURIComponent(batch.map(frame => frame.name).join("|"));
    try {
      const response = await fetch(url, {
        headers: { "accept": "application/json", "user-agent": "Warframe-Checklist-GitHub-Actions" },
        signal: AbortSignal.timeout(45000)
      });
      if (!response.ok) throw new Error("Wiki API HTTP " + response.status);
      const json = await response.json();
      for (const page of Object.values(json.query?.pages || {})) {
        if (!page.title || !Array.isArray(page.images)) continue;
        const frame = batch.find(item => normalizeTitle(item.name) === normalizeTitle(page.title));
        if (!frame) continue;
        for (const [, label] of PARTS) {
          const name = normalizeTitle(frame.name), part = normalizeTitle(label);
          const candidates = page.images.filter(image => {
            const file = normalizeTitle(image.title);
            return file.startsWith(name + " ") && file.includes(part);
          }).sort((a, b) => {
            const aa = normalizeTitle(a.title), bb = normalizeTitle(b.title);
            const ap = aa.includes("blueprint") ? 0 : 1, bp = bb.includes("blueprint") ? 0 : 1;
            return ap - bp || aa.length - bb.length;
          });
          if (candidates[0]) {
            filesByKey.set(frame.name.toLowerCase() + "|" + label.toLowerCase(), candidates[0].title);
            fileTitles.add(candidates[0].title);
          }
        }
      }
    } catch (error) {
      console.warn("Não foi possível listar imagens dos componentes da Wiki:", error.message);
    }
  }

  const urls = new Map();
  const titles = [...fileTitles];
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const url = "https://wiki.warframe.com/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=200&titles=" +
      encodeURIComponent(batch.join("|"));
    try {
      const response = await fetch(url, {
        headers: { "accept": "application/json", "user-agent": "Warframe-Checklist-GitHub-Actions" },
        signal: AbortSignal.timeout(45000)
      });
      if (!response.ok) throw new Error("Wiki API HTTP " + response.status);
      const json = await response.json();
      for (const page of Object.values(json.query?.pages || {})) {
        const info = page.imageinfo?.[0];
        if (page.title && info?.thumburl) urls.set(normalizeTitle(page.title), info.thumburl);
      }
    } catch (error) {
      console.warn("Não foi possível obter miniaturas dos componentes da Wiki:", error.message);
    }
  }

  const result = new Map();
  for (const [key, title] of filesByKey) {
    const imageUrl = urls.get(normalizeTitle(title));
    if (imageUrl) result.set(key, imageUrl);
  }
  console.log("Imagens oficiais dos componentes encontradas: " + result.size + "/" + (frames.length * PARTS.length));
  return result;
}

async function main() {
  const outputArg = process.argv.indexOf("--output");
  const outputPath = outputArg >= 0 ? process.argv[outputArg + 1] : "Content/warframes-data.js";
  if (!outputPath) throw new Error("Informe o caminho de saída após --output.");

  const [rawFrames, drops] = await Promise.all([
    fetchJson(WARFRAMES_URL),
    fetchJson(DROPS_URL)
  ]);

  for (const key of ["blueprintLocations", "relics"]) {
    if (!Array.isArray(unwrap(drops, key))) throw new Error("Dataset de drops inválido: " + key);
  }
  if (!unwrap(drops, "missionRewards") || typeof unwrap(drops, "missionRewards") !== "object") {
    throw new Error("Dataset de drops inválido: missionRewards.");
  }

  const frames = normalizeWarframes(rawFrames);
  const wikiImages = await wikiComponentThumbnails(frames.filter(frame => frame?.type === "Warframe"));
  const items = [];

  for (const frame of frames) {
    if (frame?.type !== "Warframe" || !frame.masterable || !frame.uniqueName ||
        !frame.name || EXCLUDED.has(frame.name)) continue;

    const parts = PARTS.map(([id, label]) => {
      const itemName = frame.name + " " + label + " Blueprint";
      return { id, label, image: wikiImages.get(frame.name.toLowerCase() + "|" + label.toLowerCase()) || "", drops: buildDrops(itemName, drops) };
    });

    // Warframes Prime só entram quando pelo menos uma peça tem uma fonte de obtenção atual.
    if (frame.isPrime && !parts.some(part => part.drops.length > 0)) continue;

    const imageFile = frame.imageName || "";
    const image = wikiImages.get(String(frame.name).toLowerCase()) ||
      (imageFile ? "https://wiki.warframe.com/w/Special:Redirect/file/" + encodeURIComponent(imageFile) + "?width=640" : "");

    items.push({
      id: frame.uniqueName,
      name: frame.name,
      description: frame.description || "",
      image,
      wikiUrl: wikiPageUrl(frame.name),
      parts,
      isPrime: !!frame.isPrime
    });
  }

  if (items.length < 30) {
    throw new Error("A validação encontrou apenas " + items.length + " Warframes; publicação cancelada para proteger os dados existentes.");
  }
  if (items.some(frame => frame.parts.length !== 3 || frame.parts.some(part => !Array.isArray(part.drops)))) {
    throw new Error("A validação estrutural dos componentes falhou.");
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  const data = {
    items,
    updatedAt: new Date().toISOString(),
    source: "WFCD Warframe Items + " + DROP_DATA_SOURCE,
    sourceUrl: "https://github.com/WFCD/warframe-drop-data"
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath,
    "/* Gerado automaticamente pelo GitHub Actions. Não edite manualmente. */\n" +
    "window.WFC_WARFRAMES_SNAPSHOT=" + JSON.stringify(data) + ";\n",
    "utf8"
  );
  console.log("Dados validados: " + items.length + " Warframes; arquivo: " + outputPath);
}

main().catch(error => {
  console.error("Atualização dos Warframes cancelada:", error);
  process.exitCode = 1;
});
