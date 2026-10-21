import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createAdapter } from "../src/adapter.mjs";

// The adapter reads Melvor's globals; give it a minimal stand-in.
let saved;
beforeEach(() => {
  saved = { game: globalThis.game, cloudManager: globalThis.cloudManager, location: globalThis.location };
  globalThis.game = { skills: [], items: [] };
  globalThis.location = { href: "https://melvoridle.com/index_game.php" };
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete globalThis[k];
    else globalThis[k] = v;
  }
});

const item = (id, ns = "melvorD") => ({ id: `${ns}:${id}`, name: id, media: `assets/media/bank/${id.toLowerCase()}.png` });

test("list() accepts the registry shapes the game uses", () => {
  const A = createAdapter();
  assert.deepEqual(A.list(null), []);
  assert.deepEqual(A.list([1, 2]), [1, 2]);
  assert.deepEqual(A.list({ allObjects: [1] }), [1]);
  assert.deepEqual(A.list({ registeredObjects: new Map([["a", 1]]) }), [1]);
  assert.deepEqual(A.list(new Map([["a", 1]])), [1]);
  assert.deepEqual(A.list(new Set([1])), [1]);
  assert.deepEqual(A.list({}), []);
});

test("namespaceOf reads the namespace field or the id prefix", () => {
  const A = createAdapter();
  assert.equal(A.namespaceOf({ namespace: "melvorTotH" }), "melvorTotH");
  assert.equal(A.namespaceOf({ id: "melvorAoD:Thing" }), "melvorAoD");
  assert.equal(A.namespaceOf({ id: "NoPrefix" }), "");
  assert.equal(A.namespaceOf(null), "");
});

test("isOwned follows expansion entitlements and defaults to owned", () => {
  const A = createAdapter();
  assert.equal(A.isOwned({ id: "melvorD:Log" }), true);
  assert.equal(A.isOwned({ id: "melvorTotH:Thing" }), true, "no cloudManager");
  globalThis.cloudManager = { hasTotHEntitlementAndIsEnabled: false, hasAoDEntitlement: true };
  assert.equal(A.isOwned({ id: "melvorTotH:Thing" }), false);
  assert.equal(A.isOwned({ id: "melvorAoD:Thing" }), true);
  assert.equal(A.expansionName({ id: "melvorItA:Thing" }), "Into the Abyss");
});

test("collectRoutes reads the common recipe shapes", () => {
  const ore = item("Ore");
  const coal = item("Coal");
  const bar = item("Bar");
  const seed = item("Seed");
  const herb = item("Herb");
  const p0 = item("Potion_I");
  const p1 = item("Potion_II");
  const alt = item("Alt_Bar");
  const perfect = item("Perfect_Bar");

  const smithing = {
    name: "Smithing",
    level: 1,
    actions: [
      {
        name: "Bar",
        level: 1,
        product: bar,
        baseQuantity: 1,
        itemCosts: [
          { item: ore, quantity: 1 },
          { item: coal, quantity: 2 }
        ]
      },
      { name: "Alt", level: 1, product: alt, baseQuantity: 2, alternativeCosts: [{ itemCosts: [{ item: ore, quantity: 3 }], quantityMultiplier: 2 }] }
    ]
  };
  const farming = {
    name: "Farming",
    actions: [{ name: "Herb", product: herb, seedCost: { item: seed, quantity: 3 }, baseQuantity: 5, category: { harvestMultiplier: 3 } }]
  };
  const herblore = { name: "Herblore", actions: [{ name: "Potion", potions: [p0, p1], itemCosts: [{ item: herb, quantity: 1 }] }] };
  const cooking = { name: "Cooking", actions: [{ name: "Perfect", product: bar, perfectItem: perfect, itemCosts: [{ item: ore, quantity: 1 }] }] };

  globalThis.game = { skills: [smithing, farming, herblore, cooking], shop: { purchases: [] }, bank: {} };
  const A = createAdapter();
  const routes = A.collectRoutes();
  const by = (shape) => routes.filter((r) => r.shape === shape);

  const smelt = by("itemCosts").filter((r) => r.skill === smithing);
  assert.equal(smelt.length, 1);
  assert.deepEqual(
    smelt[0].costs.map((c) => [c.item.id, c.quantity]),
    [
      ["melvorD:Ore", 1],
      ["melvorD:Coal", 2]
    ]
  );
  assert.equal(by("alternativeCosts")[0].qty, 4);
  assert.equal(by("seedCost")[0].qty, 15);
  assert.deepEqual(
    by("potions").map((r) => [r.product, r.potionTier]),
    [
      [p0, 0],
      [p1, 1]
    ]
  );
  assert.equal(by("perfectItem")[0].product, perfect);
});

test("collectRoutes skips routes for unowned expansions", () => {
  const thing = item("Thing", "melvorTotH");
  const ore = item("Ore");
  globalThis.cloudManager = { hasTotHEntitlementAndIsEnabled: false };
  globalThis.game = { skills: [{ name: "Smithing", actions: [{ name: "Thing", product: thing, itemCosts: [{ item: ore, quantity: 1 }] }] }] };
  assert.equal(createAdapter().collectRoutes().length, 0);
});

test("routeLevelLocked compares skill level and abyssal level", () => {
  const A = createAdapter();
  const skill = { level: 50, abyssalLevel: 0 };
  assert.equal(A.routeLevelLocked({ skill, level: 40 }), false);
  assert.equal(A.routeLevelLocked({ skill, level: 60 }), true);
  assert.equal(A.routeLevelLocked({ skill, level: 1, abyssalLevel: 5 }), true);
  assert.equal(A.routeLevelLocked({}), false);
});

test("equippedQuantities counts every set and food, skipping empty slots", () => {
  const helm = item("Helm");
  const arrows = item("Arrows");
  const food = item("Shrimp");
  const empty = { id: "melvorD:Empty_Equipment" };
  globalThis.game = {
    emptyEquipmentItem: empty,
    combat: {
      player: {
        equipmentSets: [
          { equipment: { equippedArray: [{ item: helm, quantity: 1 }, { item: arrows, quantity: 300 }, { item: empty }] } },
          {
            equipment: {
              equippedArray: [
                { item: helm, quantity: 1 },
                { item: helm, occupiedBy: "Shield" }
              ]
            }
          }
        ],
        food: { slots: [{ item: food, quantity: 25 }] }
      }
    }
  };
  const q = createAdapter().equippedQuantities();
  assert.equal(q.get(helm), 2);
  assert.equal(q.get(arrows), 300);
  assert.equal(q.get(food), 25);
  assert.equal(q.has(empty), false);
});

test("mediaKey normalises image URLs from /assets/ on", () => {
  const A = createAdapter();
  assert.equal(A.mediaKey("https://cdn2-main.melvor.net/assets/media/bank/Logs.png?2"), "/assets/media/bank/logs.png");
  assert.equal(A.mediaKey("assets/media/bank/logs.png"), "/assets/media/bank/logs.png");
  assert.equal(A.mediaKey("data:image/png;base64,xyz"), null);
  assert.equal(A.mediaKey(""), null);
});

test("task goal helpers read delivery and equip goals", () => {
  const A = createAdapter();
  const log = item("Log");
  const helm = item("Helm");
  const task = {
    goals: {
      itemGoals: [
        { item: log, quantity: 10 },
        { item: null, quantity: 5 }
      ],
      allGoals: [
        { item: log, quantity: 10 },
        { monster: { name: "Goblin" }, quantity: 50, items: [helm] }
      ]
    }
  };
  assert.deepEqual(A.getDeliveryGoals(task), [{ item: log, quantity: 10 }]);
  assert.equal(A.getEquipGoals(task)[0].items[0], helm);
  assert.deepEqual(
    A.taskGoals(task).map((g) => g.kind),
    ["item", "equip"]
  );
});
