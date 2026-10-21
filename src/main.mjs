// Mod entry point: settings, game hooks, and the recompute loop.

import { createAdapter } from "./adapter.mjs";
import * as model from "./model.mjs";
import { createUI } from "./ui.mjs";

// Options retired from the settings in 0.3.0. Their code is kept; set one to
// true to bring it back. (The shop venue is retired in adapter.mjs, through
// its `active` flag.)
const OPTIONS = {
  // One "Where to show" switch per skill, instead of one for all skills.
  perSkillToggles: false,
  // Let players choose a border ring instead of the corner badge.
  indicatorStyle: false
};

// The "Where to show" switches, one per venue group.
const GROUPS = {
  bank: { label: "Bank" },
  skills: { label: "Skills", hint: "Ingredients, seeds, logs, obstacle and spell costs in skill menus." },
  shop: { label: "Shop (item costs)" }
};

export async function setup(ctx) {
  const A = createAdapter();
  const ui = createUI(A, model);
  ui.installTippyPlugin();
  const opts = { showPossible: true };
  const note = (where, e) => console.error(`[Task Keeper] ${where}`, e);

  let graph = null;
  let result = null;
  let timer = null;

  function recompute() {
    timer = null;
    if (!graph) return;
    try {
      result = model.compute(A, graph, opts);
      ui.refresh(result);
    } catch (e) {
      note("recompute", e);
    }
  }

  // Changes arrive in bursts (e.g. a craft adds and removes several items);
  // coalesce them into one recompute.
  function schedule() {
    if (timer === null) timer = setTimeout(recompute, 400);
  }

  // ----------------------------------------------- settings

  const display = ctx.settings.section("Display");
  display.add({
    type: "switch",
    name: "show-possible",
    label: "Show items the casual task pool could ask for",
    hint: "The pool covers many common items, so this marks more of your bank.",
    default: true,
    onChange: (value) => {
      opts.showPossible = value;
      schedule();
    }
  });
  display.add({
    type: "dropdown",
    name: "palette",
    label: "Indicator colors",
    default: "standard",
    options: [
      { value: "standard", display: "Standard" },
      { value: "cb", display: "Colorblind-friendly" }
    ],
    onChange: (value) => ui.setPalette(value)
  });
  if (OPTIONS.indicatorStyle) {
    display.add({
      type: "dropdown",
      name: "indicator",
      label: "Indicator style",
      hint: "Border: a thin ring inside the icon. Badge: a small corner mark, shaped by status.",
      default: "border",
      options: [
        { value: "border", display: "Border" },
        { value: "badge", display: "Corner badge" }
      ],
      onChange: (value) => ui.setStyle(value)
    });
  }

  // Each switch turns a set of venues on or off.
  const activeVenues = A.VENUES.filter((v) => v.active !== false);
  const toggles = OPTIONS.perSkillToggles
    ? activeVenues.map((v) => ({ name: `venue-${v.key}`, label: v.label, default: v.default, venues: [v] }))
    : Object.entries(GROUPS)
        .map(([group, g]) => ({ name: `venue-${group}`, ...g, default: true, venues: activeVenues.filter((v) => v.group === group) }))
        .filter((t) => t.venues.length);

  const where = ctx.settings.section("Where to show");
  where.add(
    toggles.map((t) => ({
      type: "switch",
      name: t.name,
      label: t.label,
      ...(t.hint ? { hint: t.hint } : {}),
      default: t.default,
      onChange: (value) => t.venues.forEach((v) => ui.setVenue(v.key, value))
    }))
  );

  // ----------------------------------------------- game hooks

  const classes = {
    Bank: typeof Bank !== "undefined" ? Bank : undefined,
    Player: typeof Player !== "undefined" ? Player : undefined,
    TownshipTasks: typeof TownshipTasks !== "undefined" ? TownshipTasks : undefined,
    TownshipCasualTasks: typeof TownshipCasualTasks !== "undefined" ? TownshipCasualTasks : undefined
  };
  A.installPatches(ctx, classes, schedule);

  if (activeVenues.some((v) => v.key === "shop")) {
    try {
      if (typeof ShopCostsAndUnlock !== "undefined") {
        ctx.patch(ShopCostsAndUnlock, "createCostElement").after((ret) => A.tagShopCost(ret));
      } else {
        note("shop costs", "ShopCostsAndUnlock not found");
      }
    } catch (e) {
      note("shop costs", e);
    }
  }

  try {
    if (classes.Bank && typeof classes.Bank.prototype.sellAllSelectedItems === "function") {
      ctx.patch(classes.Bank, "sellAllSelectedItems").before(function () {
        // Capture the selection now; the confirmation dialog opens after.
        const items = A.selectedSellItems();
        setTimeout(() => {
          try {
            ui.annotateSellDialog(items);
          } catch (e) {
            note("sell note", e);
          }
        }, 0);
      });
    }
  } catch (e) {
    note("sell note", e);
  }

  // The bank sidebar's Tasks tab follows the selected item.
  try {
    if (typeof BankSidebarMenuElement !== "undefined") {
      ctx.patch(BankSidebarMenuElement, "setItem").after((ret, bankItem) => {
        ui.setBankItem(bankItem?.item ?? null);
      });
      ctx.patch(BankSidebarMenuElement, "setUnselected").after(() => {
        ui.setBankItem(null);
      });
    } else {
      note("bank tab", "BankSidebarMenuElement not found");
    }
  } catch (e) {
    note("bank tab", e);
  }

  // ----------------------------------------------- lifecycle

  ctx.onCharacterLoaded(() => {
    try {
      opts.showPossible = display.get("show-possible") ?? true;
      graph = model.buildGraph(A.collectRoutes());
    } catch (e) {
      note("building recipe graph", e);
    }
  });

  ctx.onInterfaceReady(() => {
    try {
      ui.setPalette(display.get("palette"));
      ui.setStyle(OPTIONS.indicatorStyle ? display.get("indicator") : "badge");
      for (const t of toggles) {
        const saved = where.get(t.name);
        const on = typeof saved === "boolean" ? saved : t.default;
        t.venues.forEach((v) => ui.setVenue(v.key, on));
      }
      ui.start();
      recompute();
    } catch (e) {
      note("starting UI", e);
    }
    try {
      if (!ui.installBankTab(document.getElementById("main-bank-sidebar"))) note("bank tab", "bank sidebar not found");
    } catch (e) {
      note("bank tab", e);
    }
    // Safety net for changes no hook catches.
    setInterval(schedule, 1e4);
  });
}
