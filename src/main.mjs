// Mod entry point: settings, game hooks, and the recompute loop.

import { createAdapter } from "./adapter.mjs";
import * as model from "./model.mjs";
import { createUI } from "./ui.mjs";

export async function setup(ctx) {
  const A = createAdapter();
  const ui = createUI(A, model);
  const tippyHooked = ui.installTippyPlugin();
  const opts = { showPossible: true };
  const errors = [];
  const note = (where, e) => {
    errors.push(`${where}: ${e?.message ?? e}`);
    console.error(`[Task Keeper] ${where}`, e);
  };

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
  display.add([
    {
      type: "switch",
      name: "show-possible",
      label: "Show items the casual task pool could ask for",
      hint: "The pool covers many common items, so this marks more of your bank.",
      default: true,
      onChange: (value) => {
        opts.showPossible = value;
        schedule();
      }
    },
    {
      type: "dropdown",
      name: "palette",
      label: "Border colors",
      default: "standard",
      options: [
        { value: "standard", display: "Standard" },
        { value: "cb", display: "Colorblind-friendly" }
      ],
      onChange: (value) => ui.setPalette(value)
    },
    {
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
    }
  ]);

  const where = ctx.settings.section("Where to show");
  where.add(
    A.VENUES.map((v) => ({
      type: "switch",
      name: `venue-${v.key}`,
      label: v.label,
      default: v.default,
      onChange: (value) => ui.setVenue(v.key, value)
    }))
  );

  // ----------------------------------------------- diagnostics

  function report() {
    let text;
    try {
      text = A.selfCheck().text;
    } catch (e) {
      text = "Self-check failed: " + e.message;
    }
    const header = [
      "Task Keeper report",
      `Game version: ${typeof gameVersion !== "undefined" ? gameVersion : "unknown"}`,
      `User agent: ${navigator.userAgent}`,
      `Items marked: ${result?.entries.size ?? "not computed"}`,
      `Merged into game tooltips: ${tippyHooked ? "yes" : "no (using own tooltip)"}`,
      ""
    ];
    const errs = errors.length ? ["", "Errors:", ...errors.slice(-10)] : ["", "Errors: none"];
    return [...header, text, ...errs].join("\n");
  }

  function getSwal() {
    if (typeof SwalLocale !== "undefined") return SwalLocale;
    if (typeof Swal !== "undefined") return Swal;
    return null;
  }

  function showText(title, text) {
    const swal = getSwal();
    if (!swal) {
      alert(text);
      return;
    }
    const box = document.createElement("div");
    box.innerHTML = `
      <textarea readonly style="width:100%;height:50vh;font:12px/1.4 monospace;white-space:pre-wrap;"></textarea>
      <button type="button" class="btn btn-sm btn-primary mt-2">Copy text</button>`;
    const area = box.querySelector("textarea");
    area.value = text;
    box.querySelector("button").addEventListener("click", async (ev) => {
      area.select();
      let ok;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) {
        ok = document.execCommand ? document.execCommand("copy") : false;
      }
      ev.target.textContent = ok ? "Copied" : "Select the text above and copy it";
    });
    swal.fire({ title, html: box, width: "42rem" });
  }

  function showReport() {
    showText("Task Keeper diagnostics", report());
  }

  ctx.settings.section("Diagnostics").add({
    type: "button",
    name: "show-report",
    display: "Show diagnostics report",
    hint: "Shows what the mod found in your game, for troubleshooting.",
    onClick: showReport
  });

  // ----------------------------------------------- game hooks

  const classes = {
    Bank: typeof Bank !== "undefined" ? Bank : undefined,
    Player: typeof Player !== "undefined" ? Player : undefined,
    TownshipTasks: typeof TownshipTasks !== "undefined" ? TownshipTasks : undefined,
    TownshipCasualTasks: typeof TownshipCasualTasks !== "undefined" ? TownshipCasualTasks : undefined
  };
  A.installPatches(ctx, classes, schedule);

  try {
    if (typeof ShopCostsAndUnlock !== "undefined") {
      ctx.patch(ShopCostsAndUnlock, "createCostElement").after((ret) => A.tagShopCost(ret));
    } else {
      note("shop costs", "ShopCostsAndUnlock not found");
    }
  } catch (e) {
    note("shop costs", e);
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
      ui.setStyle(display.get("indicator"));
      for (const v of A.VENUES) {
        const saved = where.get(`venue-${v.key}`);
        ui.setVenue(v.key, typeof saved === "boolean" ? saved : v.default);
      }
      ui.start();
      recompute();
    } catch (e) {
      note("starting UI", e);
    }
    // Safety net for changes no hook catches.
    setInterval(schedule, 1e4);
    try {
      A.selfCheck();
    } catch (e) {
      note("self-check", e);
    }
  });

  // Console access: mod.api.taskKeeper.report(), .inspect("melvorD:Bird_Nest")
  ctx.api({
    selfCheck: () => A.selfCheck(),
    report,
    recompute: () => {
      recompute();
      return result?.entries.size ?? 0;
    },
    inspect: (itemID) => {
      const item = A.findItem(itemID);
      if (!item) return `No item with id "${itemID}" (use the full id, e.g. "melvorD:Bird_Nest")`;
      return result?.entries.get(item) ?? "Not needed for any task";
    }
  });
}
