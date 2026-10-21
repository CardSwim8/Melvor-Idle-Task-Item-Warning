// Pure logic: which items to keep, and why. Reads the game only through the
// adapter `A`, so it can be tested with plain objects.

export function buildGraph(routes) {
  const byProduct = new Map();
  for (const r of routes) {
    let arr = byProduct.get(r.product);
    if (!arr) byProduct.set(r.product, (arr = []));
    arr.push(r);
  }
  return byProduct;
}

// Items tasks ask for directly. Needed (incomplete main tasks and active
// casual tasks) sum their quantities; possible (the rest of the casual pool)
// takes the largest single ask, since only a few will ever be active.
function gatherDirect(A, includePossible) {
  const needed = new Map();
  const possible = new Map();
  const entry = (map, item) => {
    let e = map.get(item);
    if (!e) map.set(item, (e = { consume: 0, equip: 0, reasons: [] }));
    return e;
  };
  const addTask = (task, kind, target, sum) => {
    for (const g of A.getDeliveryGoals(task)) {
      const e = entry(target, g.item);
      e.consume = sum ? e.consume + g.quantity : Math.max(e.consume, g.quantity);
      e.reasons.push({ kind, mode: "deliver", task, qty: g.quantity });
    }
    for (const g of A.getEquipGoals(task)) {
      for (const item of g.items) {
        const e = entry(target, item);
        e.equip = 1;
        e.reasons.push({ kind, mode: "equip", task, qty: 1, monster: g.monster, kills: g.quantity });
      }
    }
  };

  const active = new Set(A.getActiveCasual());
  for (const t of A.getMainTasks()) {
    if (A.isOwned(t) && !A.isMainTaskComplete(t)) addTask(t, "needed", needed, true);
  }
  for (const t of active) {
    if (A.isOwned(t)) addTask(t, "needed", needed, true);
  }
  if (includePossible) {
    for (const t of A.getCasualPool()) {
      if (A.isOwned(t) && !active.has(t)) addTask(t, "possible", possible, false);
    }
  }
  return { needed, possible };
}

// Products before their ingredients, so each item's full demand is known
// before it is pushed down. Cycles (e.g. upgrade/downgrade pairs) are cut.
function topoOrder(starts, graph) {
  const visited = new Set();
  const onStack = new Set();
  const post = [];
  const visit = (item) => {
    if (visited.has(item)) return;
    visited.add(item);
    onStack.add(item);
    for (const r of graph.get(item) ?? []) {
      for (const c of r.costs) if (!onStack.has(c.item)) visit(c.item);
    }
    onStack.delete(item);
    post.push(item);
  };
  starts.forEach(visit);
  return post.reverse();
}

// Push each shortfall down through every route that makes the item. All
// routes count, since we can't know which one the player will use.
function runPass(direct, available, graph, pass) {
  const demand = new Map();
  const shortfall = new Map();
  const ingredients = new Map();
  for (const [item, e] of direct) demand.set(item, e.consume + e.equip);

  for (const item of topoOrder([...direct.keys()], graph)) {
    const d = demand.get(item) ?? 0;
    if (d <= 0) continue;
    const short = Math.max(0, d - available(item));
    shortfall.set(item, short);
    if (!short) continue;
    const routes = graph.get(item);
    if (!routes) continue;
    for (const route of routes) {
      const crafts = Math.ceil(short / route.qty);
      for (const c of route.costs) {
        const qty = crafts * c.quantity;
        demand.set(c.item, (demand.get(c.item) ?? 0) + qty);
        let arr = ingredients.get(c.item);
        if (!arr) ingredients.set(c.item, (arr = []));
        arr.push({ kind: "ingredient", pass, parent: item, route, qty, alternatives: routes.length });
      }
    }
  }
  return { demand, shortfall, ingredients };
}

const EMPTY_PASS = { demand: new Map(), shortfall: new Map(), ingredients: new Map() };

export function compute(A, graph, { showPossible }) {
  const { needed, possible } = gatherDirect(A, showPossible);
  const equipped = A.equippedQuantities();
  const hold = (item) => A.bankQty(item) + (equipped.get(item) ?? 0);

  // Needed first; the possible pass only sees what is left over after it.
  const p1 = runPass(needed, hold, graph, "needed");
  const leftover = (item) => Math.max(0, hold(item) - (p1.demand.get(item) ?? 0));
  const p2 = showPossible ? runPass(possible, leftover, graph, "possible") : EMPTY_PASS;

  const entries = new Map();
  const items = new Set([...p1.demand.keys(), ...p2.demand.keys()]);
  for (const item of items) {
    const isIngredient = p1.ingredients.has(item) || p2.ingredients.has(item);
    const status = needed.has(item) ? "needed" : isIngredient ? "ingredient" : possible.has(item) ? "possible" : null;
    if (!status) continue;
    const keep = (p1.demand.get(item) ?? 0) + (p2.demand.get(item) ?? 0);
    const holdings = hold(item);
    entries.set(item, {
      status,
      keep,
      holdings,
      equipped: equipped.get(item) ?? 0,
      safe: Math.max(0, holdings - keep),
      reasons: [
        ...(needed.get(item)?.reasons ?? []),
        ...(p1.ingredients.get(item) ?? []),
        ...(possible.get(item)?.reasons ?? []),
        ...(p2.ingredients.get(item) ?? [])
      ]
    });
  }
  const casualSet = new Set([...A.getCasualPool(), ...A.getActiveCasual()]);
  return { entries, needed, possible, p1, p2, casualSet };
}

// ------------------------------------------------- tooltip description

const TIER_ORDER = ["easy", "normal", "medium", "hard", "very hard", "elite", "master"];

function lineRank(line, A) {
  if (line.kind === "main") {
    const t = TIER_ORDER.indexOf(String(A.taskTier(line.task) || "").toLowerCase());
    return t < 0 ? TIER_ORDER.length : t;
  }
  return line.kind === "casual" ? 100 : 200;
}

function sortLines(lines, A) {
  return lines.sort((a, b) => lineRank(a, A) - lineRank(b, A) || b.qty - a.qty);
}

function lineFor(reason, pass, casualActive) {
  const kind = pass === "possible" ? "pool" : casualActive.has(reason.task) ? "casual" : "main";
  return { kind, task: reason.task, mode: reason.mode, qty: reason.qty, monster: reason.monster, kills: reason.kills };
}

function routeLocked(route, A) {
  if (A.routeLevelLocked(route)) return true;
  if (route.potionTier !== undefined && route.action && route.potionTier > A.currentPotionTier(route.action)) return true;
  return false;
}

// For one item: the tasks that ask for it directly, and, grouped by the
// final product a task asks for, every crafting chain that leads there.
export function describe(item, result, A) {
  const casualActive = new Set(A.getActiveCasual());
  const direct = [];
  for (const r of result.needed.get(item)?.reasons ?? []) direct.push(lineFor(r, "needed", casualActive));
  for (const r of result.possible.get(item)?.reasons ?? []) direct.push(lineFor(r, "possible", casualActive));

  const byFinal = new Map();
  const lines = new Map();
  for (const pass of ["needed", "possible"]) {
    const P = pass === "needed" ? result.p1 : result.p2;
    const D = pass === "needed" ? result.needed : result.possible;
    const walk = (cur, chain, locked, seen) => {
      for (const ing of P.ingredients.get(cur) ?? []) {
        const next = ing.parent;
        if (seen.has(next)) continue;
        const nextChain = [...chain, next];
        const nextLocked = locked || routeLocked(ing.route, A);
        const finalEntry = D.get(next);
        if (finalEntry) {
          for (const r of finalEntry.reasons) {
            const sig = `${pass}|${nextChain.map((i) => i.id).join(">")}|${r.task.id}|${r.mode}`;
            const existing = lines.get(sig);
            if (existing) {
              // Locked only if every route along this chain is locked.
              existing.locked = existing.locked && nextLocked;
              continue;
            }
            const line = { ...lineFor(r, pass, casualActive), chain: nextChain, locked: nextLocked };
            lines.set(sig, line);
            if (!byFinal.has(next)) byFinal.set(next, []);
            byFinal.get(next).push(line);
          }
        }
        if (nextChain.length < 8) walk(next, nextChain, nextLocked, new Set([...seen, next]));
      }
    };
    walk(item, [item], false, new Set([item]));
  }

  const groups = [...byFinal.entries()].map(([final, ls]) => ({ final, lines: sortLines(ls, A) }));
  groups.sort((a, b) => lineRank(a.lines[0], A) - lineRank(b.lines[0], A));
  return { direct: sortLines(direct, A), groups };
}
