// Runs the whole mod setup against a fake game, a fake mod context and a
// small browser DOM (linkedom), to check settings, hooks and the bank tab.
// The globals below are installed in before().
/* global window, document, game, BankSidebarMenuElement, ShopCostsAndUnlock */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { setup } from "../src/main.mjs";

const SIDEBAR_HTML = `
<bank-sidebar-menu id="main-bank-sidebar">
  <ul class="nav nav-tabs nav-tabs-block" data-toggle="tabs" role="tablist">
    <li class="nav-item"><a class="nav-link active" href="#bank-selected-tab"><img></a></li>
    <li class="nav-item"><a class="nav-link" href="#bank-stats-tab"><img></a></li>
    <li class="nav-item"><a class="nav-link" href="#bank-settings-tab"><img></a></li>
  </ul>
  <div class="p-3 tab-content" id="pane-container">
    <div class="tab-pane active" id="bank-selected-tab"></div>
    <div class="tab-pane" id="bank-stats-tab"></div>
    <div class="tab-pane" id="bank-settings-tab"></div>
    <button id="sidebar-close-button"></button>
  </div>
</bank-sidebar-menu>
<township-tasks-menu id="township-tasks-menu"></township-tasks-menu>`;

const item = (id) => ({ id: `melvorD:${id}`, name: id.replace(/_/g, " "), media: `assets/media/bank/${id.toLowerCase()}.png` });

const saved = {};
const GLOBALS = [
  "window",
  "document",
  "HTMLImageElement",
  "MutationObserver",
  "requestAnimationFrame",
  "addEventListener",
  "setInterval",
  "game",
  "changePage",
  "townshipUI",
  "BankSidebarMenuElement",
  "ShopCostsAndUnlock",
  "location",
  "getComputedStyle"
];

let env;

before(() => {
  for (const k of GLOBALS) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const { window, document, HTMLImageElement } = parseHTML(`<html><body>${SIDEBAR_HTML}</body></html>`);
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set("window", window);
  set("document", document);
  set("HTMLImageElement", HTMLImageElement);
  set(
    "MutationObserver",
    class {
      observe() {}
    }
  );
  set("requestAnimationFrame", (fn) => fn());
  set("addEventListener", () => {});
  set("setInterval", () => 0);
  set("getComputedStyle", () => ({ content: "none", fontFamily: "" }));
  set("location", { href: "https://melvoridle.com/index_game.php" });

  // Game state: one incomplete Easy main task wanting 5 logs, one active
  // casual task wanting 2 ores, and one pool task wanting 3 fish.
  const logs = item("Normal_Logs");
  const ore = item("Copper_Ore");
  const fish = item("Raw_Shrimp");
  const easy = { name: "Easy" };
  const mainTask = { id: "melvorF:Easy_1", category: easy, goals: { itemGoals: [{ item: logs, quantity: 5 }], allGoals: [] } };
  const casualTask = { id: "melvorF:Casual_1", goals: { itemGoals: [{ item: ore, quantity: 2 }], allGoals: [] } };
  const poolTask = { id: "melvorF:Casual_2", goals: { itemGoals: [{ item: fish, quantity: 3 }], allGoals: [] } };
  const items = [logs, ore, fish];
  const township = { name: "Township", id: "melvorD:Township" };
  const otherPage = { id: "melvorD:Bank" };
  set("game", {
    items: { allObjects: items, getObjectByID: (id) => items.find((i) => i.id === id) },
    skills: [],
    pages: { allObjects: [township, otherPage], getObjectByID: (id) => (id === township.id ? township : undefined) },
    bank: { getQty: () => 1, selectedBankItem: undefined },
    combat: { player: { equipmentSets: [], food: { slots: [] } } },
    township: {
      tasks: { tasks: [mainTask], completedTasks: new Set() },
      casualTasks: { currentCasualTasks: [{ task: casualTask }], allCasualTasks: [casualTask, poolTask] }
    },
    openPage: otherPage
  });

  const calls = [];
  set("changePage", (page) => {
    calls.push(["changePage", page.id]);
    if (!env.townshipLocked) game.openPage = page;
  });
  set("townshipUI", { showPage: (n) => calls.push(["showPage", n]) });
  const menu = document.getElementById("township-tasks-menu");
  const card = document.createElement("township-task");
  card.scrollIntoView = () => calls.push(["scroll"]);
  menu.taskMap = new Map([[mainTask, card]]);
  menu.casualTaskMap = new Map();
  menu.showCategoryTasks = (g, t, category) => calls.push(["showCategoryTasks", category.name]);
  menu.showCasualTasks = () => calls.push(["showCasualTasks"]);

  const sidebar = document.getElementById("main-bank-sidebar");
  sidebar.paneContainer = sidebar.querySelector(".tab-content");
  sidebar.sidebarCloseButton = sidebar.querySelector("#sidebar-close-button");

  set(
    "BankSidebarMenuElement",
    class BankSidebarMenuElement {
      setItem() {}
      setUnselected() {}
    }
  );
  set(
    "ShopCostsAndUnlock",
    class ShopCostsAndUnlock {
      createCostElement() {}
    }
  );

  env = { logs, ore, fish, mainTask, card, calls, sidebar, townshipLocked: false };
});

after(() => {
  for (const k of GLOBALS) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
});

function fakeCtx() {
  const sections = new Map();
  const patches = [];
  const hooks = {};
  return {
    sections,
    patches,
    hooks,
    settings: {
      section(name) {
        if (!sections.has(name)) {
          const items = [];
          sections.set(name, { items, add: (x) => items.push(...[].concat(x)), get: () => undefined });
        }
        return sections.get(name);
      }
    },
    patch(C, method) {
      const p = { C, method };
      patches.push(p);
      return { after: (fn) => (p.after = fn), before: (fn) => (p.before = fn) };
    },
    onCharacterLoaded: (fn) => (hooks.characterLoaded = fn),
    onInterfaceReady: (fn) => (hooks.interfaceReady = fn),
    api: () => {}
  };
}

let ctx;
const pane = () => document.getElementById("tk-bank-tasks-tab");
const select = (it) => ctx.patches.find((p) => p.C === BankSidebarMenuElement && p.method === "setItem").after(undefined, { item: it });

test("setup loads and the interface starts", async () => {
  ctx = fakeCtx();
  await setup(ctx);
  ctx.hooks.characterLoaded();
  ctx.hooks.interfaceReady();
});

test("settings: no indicator style, one Bank and one Skills switch, no diagnostics", () => {
  assert.deepEqual(
    ctx.sections.get("Display").items.map((s) => s.name),
    ["show-possible", "palette"]
  );
  const where = ctx.sections.get("Where to show").items;
  assert.deepEqual(
    where.map((s) => [s.name, s.default]),
    [
      ["venue-bank", true],
      ["venue-skills", true]
    ]
  );
  assert.equal(ctx.sections.has("Diagnostics"), false);
});

test("the shop is not hooked while its venue is inactive", () => {
  assert.equal(
    ctx.patches.some((p) => p.C === ShopCostsAndUnlock),
    false
  );
});

test("indicators are corner badges", () => {
  assert.equal(document.body.classList.contains("tk-style-badge"), true);
});

test("the bank sidebar gets a Tasks tab with the Township tasks icon", () => {
  const links = env.sidebar.querySelectorAll("ul.nav .nav-link");
  assert.equal(links.length, 4);
  const link = links[3];
  assert.equal(link.getAttribute("href"), "#tk-bank-tasks-tab");
  assert.match(link.querySelector("img").getAttribute("src"), /skills\/township\/menu_tasks\.png$/);
  // The pane sits with the others, before the close button.
  assert.equal(pane().parentElement, env.sidebar.paneContainer);
  assert.equal(pane().nextElementSibling, env.sidebar.sidebarCloseButton);
  assert.match(pane().textContent, /Select an item/);
});

test("clicking the tab shows its pane and hides the others", () => {
  const link = env.sidebar.querySelectorAll("ul.nav .nav-link")[3];
  link.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.equal(link.classList.contains("active"), true);
  assert.equal(pane().classList.contains("active"), true);
  assert.equal(document.getElementById("bank-selected-tab").classList.contains("active"), false);
  assert.equal(env.sidebar.querySelectorAll("ul.nav .nav-link.active").length, 1);
});

test("selecting a needed item shows keep/have/spare and a linked task", () => {
  select(env.logs);
  const text = pane().textContent.replace(/\s+/g, " ");
  assert.match(text, /Keep 5/);
  assert.match(text, /Have 1/);
  assert.match(text, /Spare 0/);
  assert.equal(pane().querySelectorAll("a.tk-task-link").length, 1);
});

test("selecting an item no task needs says so", () => {
  select({ id: "melvorD:Bones", name: "Bones", media: "x.png" });
  assert.match(pane().textContent, /No Township task needs Bones/);
});

test("pool tasks are listed but not linked", () => {
  select(env.fish);
  assert.match(pane().textContent, /Casual Task Pool/);
  assert.equal(pane().querySelectorAll("a.tk-task-link").length, 0);
});

test("a task link opens Township on that task's category and scrolls to its card", () => {
  select(env.logs);
  env.calls.length = 0;
  pane()
    .querySelector("a.tk-task-link")
    .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(env.calls, [["changePage", "melvorD:Township"], ["showPage", 2], ["showCategoryTasks", "Easy"], ["scroll"]]);
  assert.equal(env.card.classList.contains("tk-flash"), true);
});

test("an active casual task link opens the casual tasks", () => {
  select(env.ore);
  env.calls.length = 0;
  pane()
    .querySelector("a.tk-task-link")
    .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(env.calls.slice(0, 3), [["changePage", "melvorD:Township"], ["showPage", 2], ["showCasualTasks"]]);
});

test("if Township won't open (locked), nothing else happens", () => {
  game.openPage = { id: "melvorD:Bank" };
  env.townshipLocked = true;
  select(env.logs);
  env.calls.length = 0;
  pane()
    .querySelector("a.tk-task-link")
    .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(env.calls, [["changePage", "melvorD:Township"]]);
  env.townshipLocked = false;
});

test("deselecting clears the tab", () => {
  ctx.patches.find((p) => p.C === BankSidebarMenuElement && p.method === "setUnselected").after();
  assert.match(pane().textContent, /Select an item/);
});
