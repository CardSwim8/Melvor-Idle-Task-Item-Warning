// The only module that touches Melvor's globals. Everything game-shaped is
// read through here so the model can be tested against plain objects.

export function createAdapter() {
  function list(reg) {
    if (!reg) return [];
    if (Array.isArray(reg)) return reg;
    if (Array.isArray(reg.allObjects)) return reg.allObjects;
    if (reg.registeredObjects instanceof Map) return [...reg.registeredObjects.values()];
    if (reg instanceof Map) return [...reg.values()];
    if (reg instanceof Set) return [...reg];
    if (typeof reg[Symbol.iterator] === "function") return [...reg];
    return [];
  }

  function namespaceOf(obj) {
    if (!obj) return "";
    if (typeof obj.namespace === "string") return obj.namespace;
    const id = obj.id ?? "";
    const i = id.indexOf(":");
    return i > 0 ? id.slice(0, i) : "";
  }

  const EXPANSIONS = {
    melvorTotH: { name: "Throne of the Herald", flags: ["hasTotHEntitlementAndIsEnabled", "hasTotHEntitlement"] },
    melvorAoD: { name: "Atlas of Discovery", flags: ["hasAoDEntitlementAndIsEnabled", "hasAoDEntitlement"] },
    melvorItA: { name: "Into the Abyss", flags: ["hasItAEntitlementAndIsEnabled", "hasItAEntitlement"] }
  };

  function expansionName(obj) {
    return EXPANSIONS[namespaceOf(obj)]?.name ?? null;
  }

  function isOwned(obj) {
    const exp = EXPANSIONS[namespaceOf(obj)];
    if (!exp) return true;
    const cm = globalThis.cloudManager;
    if (!cm) return true;
    for (const flag of exp.flags) {
      if (typeof cm[flag] === "boolean") return cm[flag];
    }
    return true;
  }

  const township = () => game.township;
  const casualSystem = () => township()?.casualTasks ?? township()?.tasks?.casualTasks;

  function getMainTasks() {
    return list(township()?.tasks?.tasks);
  }

  function isMainTaskComplete(task) {
    const done = township()?.tasks?.completedTasks;
    return done?.has?.(task) ?? false;
  }

  function getCasualPool() {
    const c = casualSystem();
    return list(c?.allCasualTasks ?? c?.casualTasks ?? c?.tasks);
  }

  function getActiveCasual() {
    const c = casualSystem();
    const current = c?.currentCasualTasks ?? c?.activeTasks ?? [];
    return list(current)
      .map((e) => e?.task ?? e)
      .filter(Boolean);
  }

  function getDeliveryGoals(task) {
    const g = task?.goals;
    return list(g?.itemGoals)
      .map((x) => ({ item: x.item, quantity: x.quantity }))
      .filter((x) => x.item && x.quantity > 0);
  }

  function getEquipGoals(task) {
    return list(task?.goals?.allGoals)
      .filter((x) => x && x.monster && Array.isArray(x.items))
      .map((x) => ({ monster: x.monster, quantity: x.quantity, items: list(x.items) }))
      .filter((x) => x.items.length > 0);
  }

  function taskName(task) {
    try {
      if (task?.hasDescription && task.description) return task.description;
    } catch (e) {}
    return null;
  }

  const stripHTML = (h) =>
    String(h ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();

  function taskGoals(task) {
    const out = [];
    for (const g of list(task?.goals?.allGoals)) {
      try {
        if (g.item && typeof g.quantity === "number") out.push({ kind: "item", item: g.item, media: g.item.media, name: g.item.name, qty: g.quantity });
        else if (g.monster && Array.isArray(g.items))
          out.push({ kind: "equip", media: g.monster.media, name: g.monster.name, qty: g.quantity, items: list(g.items) });
        else if (g.monster) out.push({ kind: "monster", media: g.monster.media, name: g.monster.name, qty: g.quantity });
        else if (g.skill) out.push({ kind: "skill", media: g.skill.media, name: g.skill.name, qty: g.quantity });
        else out.push({ kind: "text", text: stripHTML(g.getDescriptionHTML?.()) });
      } catch (e) {}
    }
    return out;
  }

  function taskTier(task) {
    const c = task?.category;
    if (!c) return null;
    return typeof c === "string" ? c : (c.name ?? null);
  }

  function bankQty(item) {
    return game.bank?.getQty?.(item) ?? 0;
  }

  function isEmptyItem(item) {
    if (!item) return true;
    if (item === game.emptyEquipmentItem || item === game.emptyFoodItem) return true;
    const id = item.id ?? "";
    return id.endsWith(":Empty_Equipment") || id.endsWith(":Empty_Food");
  }

  // Everything worn in any equipment set, plus food slots, so items that are
  // equipped rather than banked still count as held.
  function equippedQuantities() {
    const out = new Map();
    const add = (item, qty) => {
      if (isEmptyItem(item)) return;
      out.set(item, (out.get(item) ?? 0) + (qty > 0 ? qty : 1));
    };
    const player = game.combat?.player;
    for (const set of list(player?.equipmentSets)) {
      const eq = set?.equipment ?? set;
      const slots = eq?.equippedArray ?? Object.values(eq?.equippedItems ?? {});
      for (const slot of list(slots)) {
        if (slot?.occupiedBy && slot.occupiedBy !== "None") continue;
        add(slot?.item, slot?.quantity);
      }
    }
    for (const slot of list(player?.food?.slots)) add(slot?.item, slot?.quantity);
    return out;
  }

  function costs(raw) {
    return list(raw)
      .map((c) => ({ item: c.item, quantity: c.quantity }))
      .filter((c) => c.item && c.quantity > 0);
  }

  function costsFromCostsObject(c) {
    if (!c || !(c._items instanceof Map)) return [];
    return [...c._items.entries()].map(([item, quantity]) => ({ item, quantity })).filter((x) => x.item && x.quantity > 0);
  }

  function summoningCosts(skill, a, it) {
    try {
      const exact = costsFromCostsObject(skill.getAltRecipeCosts(a, it));
      if (exact.length) return { costs: exact, approx: false };
    } catch (e) {}
    return { costs: [...costs(a.itemCosts), { item: it, quantity: 1 }], approx: true };
  }

  const isItem = (x) => x && typeof x === "object" && typeof x.id === "string" && "media" in x;

  // One action can yield several routes (alternative costs, summoning
  // non-shard choices, potion tiers, perfect items). Each route says: this
  // product, at this quantity per craft, from these costs.
  function routesForAction(skill, a) {
    const out = [];
    const base = { skill, level: a.level ?? 1, abyssalLevel: a.abyssalLevel ?? 0, action: a };
    const qty = a.baseQuantity ?? 1;

    if (Array.isArray(a.potions)) {
      a.potions.forEach((p, tier) => out.push({ ...base, shape: "potions", product: p, qty: 1, costs: costs(a.itemCosts), potionTier: tier }));
      return out;
    }
    if (a.seedCost && a.product) {
      const mult = a.category?.harvestMultiplier ?? 1;
      out.push({ ...base, shape: "seedCost", product: a.product, qty: Math.max(1, qty * mult), costs: costs([a.seedCost]), approx: true });
      return out;
    }
    if (Array.isArray(a.fixedItemCosts) && "produces" in a) {
      if (isItem(a.produces) && a.fixedItemCosts.length) {
        out.push({ ...base, shape: "altMagic", product: a.produces, qty: a.productionRatio || 1, costs: costs(a.fixedItemCosts) });
      }
      return out;
    }
    if (!a.product) return out;

    const nonShard = list(a.nonShardItemCosts);
    if (nonShard.length) {
      for (const it of nonShard) {
        const c = summoningCosts(skill, a, it);
        out.push({ ...base, shape: "summoning", product: a.product, qty, costs: c.costs, approx: c.approx });
      }
    } else if (list(a.alternativeCosts).length) {
      for (const alt of a.alternativeCosts) {
        out.push({ ...base, shape: "alternativeCosts", product: a.product, qty: qty * (alt.quantityMultiplier ?? 1), costs: costs(alt.itemCosts) });
      }
    } else if (a.costs && Array.isArray(a.costs.items)) {
      out.push({ ...base, shape: "fixedCosts", product: a.product, qty, costs: costs(a.costs.items) });
    } else {
      out.push({ ...base, shape: "itemCosts", product: a.product, qty, costs: costs(a.itemCosts) });
    }
    if (a.perfectItem && a.perfectItem !== a.product) {
      out.push({ ...base, shape: "perfectItem", product: a.perfectItem, qty, costs: costs(a.itemCosts), chance: true });
    }
    return out;
  }

  function skillActions(skill) {
    const acts = list(skill?.actions);
    if (skill?.paperRecipes) acts.push(...list(skill.paperRecipes));
    return acts;
  }

  let routeStats = [];

  function collectRoutes() {
    const routes = [];
    routeStats = [];
    for (const skill of list(game.skills)) {
      let made = 0;
      const dropped = [];
      for (const action of skillActions(skill)) {
        let rs = [];
        try {
          rs = routesForAction(skill, action);
        } catch (e) {}
        const kept = rs.filter((r) => r.product && r.costs.length);
        made += kept.length;
        routes.push(...kept);
        // Report actions that look like recipes but produced no route, so a
        // game update that changes a shape shows up in diagnostics.
        const makesItem = action && (action.product || Array.isArray(action.potions) || isItem(action.produces));
        const hasInputs =
          action &&
          (list(action.itemCosts).length ||
            action.seedCost ||
            list(action.fixedItemCosts).length ||
            list(action.nonShardItemCosts).length ||
            list(action.alternativeCosts).length ||
            (action.costs && list(action.costs.items).length));
        if (makesItem && hasInputs && !kept.length) dropped.push(action.name ?? action.id);
      }
      if (made || dropped.length) routeStats.push({ skill: skill.name ?? skill.id, routes: made, dropped });
    }

    let shopRoutes = 0;
    for (const p of list(game.shop?.purchases)) {
      try {
        const cost = costs(p.costs?.items);
        if (!cost.length) continue;
        for (const c of list(p.contains?.items)) {
          if (!c?.item) continue;
          routes.push({ shape: "shop", product: c.item, qty: c.quantity || 1, costs: cost, purchase: p });
          shopRoutes++;
        }
      } catch (e) {}
    }
    routeStats.push({ skill: "Shop", routes: shopRoutes, dropped: [] });

    let upgradeRoutes = 0;
    const upgrades = game.bank?.itemUpgrades;
    if (upgrades) {
      const seen = new Set();
      for (const group of list(upgrades)) {
        for (const u of list(group)) {
          if (!u || seen.has(u) || u.isDowngrade) continue;
          seen.add(u);
          routes.push({ shape: "upgrade", product: u.upgradedItem, qty: u.upgradedQuantity ?? 1, costs: costs(u.itemCosts), upgrade: true });
          upgradeRoutes++;
        }
      }
    }
    routeStats.push({ skill: "Item upgrades", routes: upgradeRoutes, dropped: [] });

    return routes.filter((r) => r.product && r.costs.length && isOwned(r.product) && isOwned(r.action ?? r.product));
  }

  function skillLevel(skill) {
    return skill?.level ?? 0;
  }

  function routeLevelLocked(route) {
    const sk = route.skill;
    if (!sk) return false;
    if ((sk.level ?? 0) < (route.level ?? 0)) return true;
    if ((route.abyssalLevel ?? 0) > 0 && (sk.abyssalLevel ?? 0) < route.abyssalLevel) return true;
    return false;
  }

  function currentPotionTier(action) {
    try {
      const t = game.herblore?.getPotionTier?.(action);
      if (typeof t === "number") return t;
      const lvl = game.herblore?.getMasteryLevel?.(action) ?? 1;
      return lvl >= 90 ? 3 : lvl >= 50 ? 2 : lvl >= 20 ? 1 : 0;
    } catch (e) {
      return 0;
    }
  }

  // Icons are matched to items by image path, normalised from /assets/ on so
  // CDN and local builds agree.
  function mediaKey(src) {
    if (!src || src.startsWith("data:")) return null;
    try {
      const path = decodeURIComponent(new URL(src, location.href).pathname).toLowerCase();
      const i = path.indexOf("/assets/");
      return i >= 0 ? path.slice(i) : path;
    } catch (e) {
      return null;
    }
  }

  function buildMediaIndex() {
    const index = new Map();
    for (const item of list(game.items)) {
      const key = mediaKey(item?.media);
      if (!key) continue;
      const arr = index.get(key);
      if (arr) arr.push(item);
      else index.set(key, [item]);
    }
    return index;
  }

  // Where icons get marked. A zone is either a custom element tag (optionally
  // limited to some of its fields) or a data-tk-zone attribute we add
  // ourselves. Venues with `pages` only match inside those skill pages.
  const ARTISAN = [
    { tag: "artisan-menu", fields: ["requires", "haves", "recipeDropdownItems"] },
    { tag: "herblore-artisan-menu", fields: ["requires", "haves", "recipeDropdownItems"] }
  ];

  const VENUES = [
    {
      key: "shop",
      label: "Shop (item costs)",
      default: true,
      zones: [{ attr: "shop" }]
    },
    {
      key: "bank",
      label: "Bank",
      default: true,
      zones: [{ tag: "bank-item-icon" }, { tag: "bank-selected-item-menu", fields: ["itemImage"] }]
    },
    {
      key: "farming",
      label: "Farming (seed selection)",
      default: true,
      zones: [
        { tag: "farming-seed-select", fields: ["seedButtonContainer"] },
        { tag: "farming-plot", fields: ["selectSeedDropdownButton", "selectSeedDropdownOptions"] }
      ]
    },
    {
      key: "firemaking",
      label: "Firemaking (logs)",
      default: true,
      zones: [{ tag: "firemaking-log-menu", fields: ["logSelectButton", "logOptionsContainer", "logQuantity", "primaryHaves"] }]
    },
    {
      key: "cooking",
      label: "Cooking (ingredients)",
      default: true,
      zones: [
        { tag: "cooking-menu", fields: ["requires", "haves"] },
        { tag: "cooking-recipe-selection", fields: ["costIcons"] }
      ]
    },
    { key: "smithing", label: "Smithing (ingredients)", pages: ["Smithing"], default: true, zones: ARTISAN },
    { key: "fletching", label: "Fletching (ingredients)", pages: ["Fletching"], default: true, zones: ARTISAN },
    { key: "crafting", label: "Crafting (ingredients)", pages: ["Crafting"], default: true, zones: ARTISAN },
    { key: "runecrafting", label: "Runecrafting (ingredients)", pages: ["Runecrafting"], default: true, zones: ARTISAN },
    { key: "herblore", label: "Herblore (ingredients)", pages: ["Herblore"], default: true, zones: ARTISAN },
    {
      key: "agility",
      label: "Agility (obstacle costs)",
      default: true,
      zones: [{ tag: "agility-obstacle-selection", fields: ["costContainer"] }]
    },
    { key: "summoning", label: "Summoning (ingredients)", pages: ["Summoning"], default: true, zones: ARTISAN },
    {
      key: "altMagic",
      label: "Alt. Magic (spell costs)",
      default: true,
      zones: [
        { tag: "alt-magic-menu", fields: ["runeRequirements", "itemRequirementsContainer", "runeHaves", "itemHavesContainer"] },
        { tag: "alt-magic-item-menu", fields: ["buttonContainer"] }
      ]
    }
  ];

  const cssEscape = (s) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&"));

  function venuePages() {
    const byLocal = new Map();
    for (const page of list(game.pages)) {
      const local = page?.localID ?? (page?.id ?? "").split(":")[1];
      if (local && page.containerID) byLocal.set(local, "#" + cssEscape(page.containerID));
    }
    const out = new Map();
    for (const v of VENUES) {
      if (!v.pages) continue;
      const sels = v.pages.map((p) => byLocal.get(p)).filter(Boolean);
      if (sels.length) out.set(v.key, sels.join(","));
    }
    return out;
  }

  function inFields(host, fields, img) {
    for (const f of fields) {
      const v = host[f];
      const els = Array.isArray(v) ? v : [v];
      for (const el of els) if (el && el.contains && el.contains(img)) return true;
    }
    return false;
  }

  function venueOfIcon(img, pages) {
    for (const v of VENUES) {
      if (v.pages) {
        const sel = pages.get(v.key);
        if (!sel || !img.closest(sel)) continue;
      }
      for (const z of v.zones) {
        if (z.attr) {
          if (img.closest(`[data-tk-zone="${z.attr}"]`)) return v.key;
          continue;
        }
        const host = img.closest(z.tag);
        if (!host) continue;
        if (!z.fields || inFields(host, z.fields, img)) return v.key;
      }
    }
    return null;
  }

  function zoneCounts() {
    const tags = new Set();
    for (const v of VENUES) for (const z of v.zones) if (z.tag) tags.add(z.tag);
    const out = [...tags].map((t) => `${t} ${document.querySelectorAll(t).length}`);
    out.push(`shop costs ${document.querySelectorAll('[data-tk-zone="shop"]').length}`);
    return out.join(", ");
  }

  function tagShopCost(ret) {
    try {
      if (ret && ret.image) ret.image.setAttribute("data-tk-zone", "shop");
    } catch (e) {}
    return ret;
  }

  function selectedSellItems() {
    return list(game.bank?.selectedItems)
      .map((b) => b?.item ?? b)
      .filter(Boolean);
  }

  function findItem(id) {
    return game.items?.getObjectByID?.(id) ?? null;
  }

  // Game methods after which holdings or tasks may have changed.
  const PATCHES = [
    // Bank contents
    ["Bank", "addItem"],
    ["Bank", "removeItemQuantity"],
    // Equipment and food
    ["Player", "equipItem"],
    ["Player", "unequipItem"],
    ["Player", "changeEquipmentSet"],
    ["Player", "equipFood"],
    ["Player", "unequipFood"],
    // Tasks
    ["TownshipTasks", "completeTask"],
    ["TownshipCasualTasks", "completeTask"],
    ["TownshipCasualTasks", "addTask"],
    ["TownshipCasualTasks", "removeTask"]
  ];

  const patchReport = [];

  function installPatches(ctx, classes, onChange) {
    for (const [cls, method] of PATCHES) {
      const C = classes[cls];
      if (!C || typeof C.prototype?.[method] !== "function") {
        patchReport.push({ patch: `${cls}.${method}`, ok: false });
        continue;
      }
      try {
        ctx.patch(C, method).after(function (ret) {
          onChange();
          return ret;
        });
        patchReport.push({ patch: `${cls}.${method}`, ok: true });
      } catch (e) {
        patchReport.push({ patch: `${cls}.${method}`, ok: false, error: String(e) });
      }
    }
  }

  function selfCheck() {
    const rows = [];
    const check = (name, fn) => {
      try {
        rows.push({ check: name, result: fn() });
      } catch (e) {
        rows.push({ check: name, result: "ERROR: " + e.message });
      }
    };
    const main = getMainTasks();
    const pool = getCasualPool();
    check("Main tasks found", () => main.length);
    check("Main tasks completed", () => main.filter(isMainTaskComplete).length);
    check("Casual pool size", () => pool.length);
    check("Active casual tasks", () => getActiveCasual().length);
    check("Tasks with item delivery goals", () => [...main, ...pool].filter((t) => getDeliveryGoals(t).length).length);
    check("Tasks with equipped-item goals", () => [...main, ...pool].filter((t) => getEquipGoals(t).length).length);
    check("Recipe routes", () => collectRoutes().length);
    check("Routes per skill", () => routeStats.map((r) => `${r.skill} ${r.routes}`).join(", "));
    check("Dropped recipes", () => {
      const d = routeStats.filter((r) => r.dropped.length);
      return d.length
        ? d.map((r) => `${r.skill}: ${r.dropped.slice(0, 8).join(", ")}${r.dropped.length > 8 ? ` (+${r.dropped.length - 8})` : ""}`).join("; ")
        : "none";
    });
    check("Equipment sets", () => list(game.combat?.player?.equipmentSets).length);
    check("Distinct equipped items", () => equippedQuantities().size);
    check("Item images indexed", () => buildMediaIndex().size);
    check("Venue pages found", () => [...venuePages().keys()].join(", ") || "NONE");
    check("Zones on screen now", () => zoneCounts());
    check("Expansions owned", () =>
      Object.entries(EXPANSIONS)
        .map(([ns, e]) => `${e.name}: ${isOwned({ id: ns + ":x" })}`)
        .join("; ")
    );
    const text = [
      ...rows.map((r) => `${r.check}: ${r.result}`),
      "",
      "Change hooks:",
      ...patchReport.map((p) => `  ${p.ok ? "ok  " : "FAIL"} ${p.patch}${p.error ? " (" + p.error + ")" : ""}`)
    ].join("\n");
    console.groupCollapsed("[Task Keeper] self-check");
    console.table(rows);
    console.table(patchReport);
    console.groupEnd();
    return { rows, patches: patchReport, text };
  }

  return {
    list,
    namespaceOf,
    expansionName,
    isOwned,
    getMainTasks,
    isMainTaskComplete,
    getCasualPool,
    getActiveCasual,
    getDeliveryGoals,
    getEquipGoals,
    taskName,
    taskGoals,
    taskTier,
    bankQty,
    equippedQuantities,
    collectRoutes,
    skillLevel,
    routeLevelLocked,
    currentPotionTier,
    VENUES,
    venuePages,
    venueOfIcon,
    tagShopCost,
    selectedSellItems,
    mediaKey,
    buildMediaIndex,
    findItem,
    installPatches,
    selfCheck
  };
}
