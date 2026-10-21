import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, compute, describe } from "../src/model.mjs";

// ------------------------------------------------- fixtures

const item = (id) => ({ id: `melvorD:${id}`, name: id, media: `assets/${id}.png` });

const ore = item("Ore");
const bar = item("Bar");
const sword = item("Sword");
const log = item("Log");
const fish = item("Fish");
const helm = item("Helm");

const deliver = (id, goals, extra = {}) => ({ id, deliver: goals, ...extra });
const route = (product, costs, extra = {}) => ({ product, qty: 1, costs: costs.map(([i, q]) => ({ item: i, quantity: q })), ...extra });

// A fake adapter: tasks carry their goals directly.
function fakeAdapter({ main = [], completed = [], active = [], pool = [], bank = new Map(), equipped = new Map(), locked = new Set() } = {}) {
  return {
    getMainTasks: () => main,
    isMainTaskComplete: (t) => completed.includes(t),
    getActiveCasual: () => active,
    getCasualPool: () => pool,
    isOwned: () => true,
    getDeliveryGoals: (t) => (t.deliver ?? []).map(([i, quantity]) => ({ item: i, quantity })),
    getEquipGoals: (t) => t.equip ?? [],
    equippedQuantities: () => equipped,
    bankQty: (i) => bank.get(i) ?? 0,
    taskTier: (t) => t.tier ?? null,
    routeLevelLocked: (r) => locked.has(r),
    currentPotionTier: () => 0
  };
}

const run = (A, routes = [], showPossible = true) => compute(A, buildGraph(routes), { showPossible });

// ------------------------------------------------- compute

test("needed tasks sum their asks for the same item", () => {
  const A = fakeAdapter({ main: [deliver("t1", [[log, 100]]), deliver("t2", [[log, 50]])] });
  const e = run(A).entries.get(log);
  assert.equal(e.status, "needed");
  assert.equal(e.keep, 150);
});

test("completed main tasks are ignored", () => {
  const t = deliver("t1", [[log, 100]]);
  const A = fakeAdapter({ main: [t], completed: [t] });
  assert.equal(run(A).entries.has(log), false);
});

test("casual pool takes the largest single ask, not the sum", () => {
  const A = fakeAdapter({ pool: [deliver("c1", [[fish, 20]]), deliver("c2", [[fish, 35]])] });
  const e = run(A).entries.get(fish);
  assert.equal(e.status, "possible");
  assert.equal(e.keep, 35);
});

test("active casual tasks count as needed and leave the possible pass", () => {
  const c1 = deliver("c1", [[fish, 20]]);
  const A = fakeAdapter({ active: [c1], pool: [c1] });
  const r = run(A);
  assert.equal(r.entries.get(fish).status, "needed");
  assert.equal(r.possible.has(fish), false);
});

test("showPossible=false drops the pool entirely", () => {
  const A = fakeAdapter({ pool: [deliver("c1", [[fish, 20]])] });
  assert.equal(run(A, [], false).entries.has(fish), false);
});

test("a shortfall pushes demand down to ingredients, scaled by recipe", () => {
  const A = fakeAdapter({ main: [deliver("t1", [[sword, 3]])] });
  const routes = [route(sword, [[bar, 2]]), route(bar, [[ore, 1]])];
  const r = run(A, routes);
  assert.equal(r.entries.get(sword).status, "needed");
  assert.equal(r.entries.get(bar).status, "ingredient");
  assert.equal(r.entries.get(bar).keep, 6);
  assert.equal(r.entries.get(ore).keep, 6);
});

test("holdings reduce the shortfall before it reaches ingredients", () => {
  const A = fakeAdapter({
    main: [deliver("t1", [[sword, 3]])],
    bank: new Map([
      [sword, 1],
      [bar, 1]
    ])
  });
  const routes = [route(sword, [[bar, 2]]), route(bar, [[ore, 1]])];
  const r = run(A, routes);
  // 2 swords short -> 4 bars, 1 banked -> 3 ore
  assert.equal(r.entries.get(bar).keep, 4);
  assert.equal(r.entries.get(ore).keep, 3);
  assert.equal(r.entries.get(sword).safe, 0);
});

test("recipes that yield several per craft round crafts up", () => {
  const A = fakeAdapter({ main: [deliver("t1", [[bar, 5]])] });
  const r = run(A, [route(bar, [[ore, 1]], { qty: 2 })]);
  assert.equal(r.entries.get(ore).keep, 3);
});

test("no shortfall means ingredients are not marked", () => {
  const A = fakeAdapter({ main: [deliver("t1", [[sword, 1]])], bank: new Map([[sword, 5]]) });
  const r = run(A, [route(sword, [[bar, 2]])]);
  assert.equal(r.entries.has(bar), false);
  assert.equal(r.entries.get(sword).safe, 4);
});

test("equipped items count as held", () => {
  const A = fakeAdapter({
    main: [{ id: "t1", equip: [{ monster: { name: "Goblin" }, quantity: 50, items: [helm] }] }],
    equipped: new Map([[helm, 1]])
  });
  const e = run(A).entries.get(helm);
  assert.equal(e.status, "needed");
  assert.equal(e.equipped, 1);
  assert.equal(e.safe, 0);
});

test("the possible pass only sees what needed tasks leave over", () => {
  const A = fakeAdapter({
    main: [deliver("t1", [[log, 10]])],
    pool: [deliver("c1", [[log, 10]])],
    bank: new Map([[log, 15]])
  });
  const r = run(A);
  assert.equal(r.p1.shortfall.get(log), 0);
  assert.equal(r.p2.shortfall.get(log), 5);
  assert.equal(r.entries.get(log).keep, 20);
});

test("recipe cycles terminate", () => {
  const A = fakeAdapter({ main: [deliver("t1", [[bar, 1]])] });
  const routes = [route(bar, [[ore, 1]]), route(ore, [[bar, 1]])];
  const r = run(A, routes);
  assert.equal(r.entries.get(bar).status, "needed");
  assert.equal(r.entries.get(ore).status, "ingredient");
});

// ------------------------------------------------- describe

test("describe lists direct asks and crafting chains to the final product", () => {
  const t1 = deliver("t1", [[sword, 1]], { tier: "Easy" });
  const A = fakeAdapter({ main: [t1] });
  const r = run(A, [route(sword, [[bar, 1]]), route(bar, [[ore, 1]])]);

  const d = describe(ore, r, A);
  assert.equal(d.direct.length, 0);
  assert.equal(d.groups.length, 1);
  assert.equal(d.groups[0].final, sword);
  assert.deepEqual(d.groups[0].lines[0].chain, [ore, bar, sword]);
  assert.equal(d.groups[0].lines[0].kind, "main");
  assert.equal(d.groups[0].lines[0].locked, false);

  const s = describe(sword, r, A);
  assert.equal(s.direct.length, 1);
  assert.equal(s.direct[0].task, t1);
});

test("a chain is locked when a route along it is level-locked", () => {
  const smelt = route(bar, [[ore, 1]]);
  const A = fakeAdapter({ main: [deliver("t1", [[bar, 1]])], locked: new Set([smelt]) });
  const r = run(A, [smelt]);
  assert.equal(describe(ore, r, A).groups[0].lines[0].locked, true);
});

test("direct lines sort main tasks by tier, then casual, then pool", () => {
  const hard = deliver("hard", [[log, 1]], { tier: "Hard" });
  const easy = deliver("easy", [[log, 1]], { tier: "Easy" });
  const casual = deliver("casual", [[log, 1]]);
  const pooled = deliver("pooled", [[log, 1]]);
  const A = fakeAdapter({ main: [hard, easy], active: [casual], pool: [casual, pooled] });
  const d = describe(log, run(A), A);
  assert.deepEqual(
    d.direct.map((l) => l.task.id),
    ["easy", "hard", "casual", "pooled"]
  );
});
