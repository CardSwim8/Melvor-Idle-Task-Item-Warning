// Marks item icons on screen and shows the "kept for" tooltip section.

export function createUI(A, model) {
  let mediaIndex = new Map();
  let pages = new Map();
  let enabled = {};
  let result = null;
  let observer = null;
  const pending = new Set();
  let flushQueued = false;

  const tip = document.createElement("div");
  tip.id = "tk-tooltip";
  tip.setAttribute("role", "tooltip");
  let tipTarget = null;

  const keyOf = (img) => A.mediaKey(img.getAttribute("src") ? img.src : null);

  // Only mark icons whose image belongs to exactly one item.
  function itemForKey(key) {
    const items = key ? mediaIndex.get(key) : null;
    return items && items.length === 1 ? items[0] : null;
  }

  function inScope(img) {
    if (img.closest("#tk-tooltip, .tk-section, .tk-sell-note, .tk-bank-tab")) return false;
    const venue = A.venueOfIcon(img, pages);
    return !!venue && !!enabled[venue];
  }

  // ----------------------------------------------- corner badges

  let badgeMode = false;
  const badges = new Map();
  const resizeObs =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          for (const e of entries) placeBadge(e.target);
        })
      : null;

  const SHAPES = {
    needed: '<circle cx="8" cy="8" r="5.5"/>',
    ingredient:
      '<path d="M8 2.2 Q8.9 2.2 9.6 2.9 L13.1 6.4 Q13.8 7.1 13.8 8 Q13.8 8.9 13.1 9.6 L9.6 13.1 Q8.9 13.8 8 13.8 Q7.1 13.8 6.4 13.1 L2.9 9.6 Q2.2 8.9 2.2 8 Q2.2 7.1 2.9 6.4 L6.4 2.9 Q7.1 2.2 8 2.2 Z"/>',
    possible: '<circle cx="8" cy="8" r="4.6" fill="none" stroke-width="2.6"/>'
  };

  function badgeSVG(status) {
    return `<svg viewBox="0 0 16 16" aria-hidden="true">${SHAPES[status] || ""}</svg>`;
  }

  function removeBadge(img) {
    const b = badges.get(img);
    if (!b) return;
    b.remove();
    badges.delete(img);
    if (resizeObs) resizeObs.unobserve(img);
  }

  function placeBadge(img) {
    const b = badges.get(img);
    if (!b) return;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    if (!w || !h) {
      b.style.display = "none";
      return;
    }
    const size = Math.round(Math.min(16, Math.max(8, w * 0.26)));
    const inset = Math.round(size * 0.1);
    b.style.display = "";
    b.style.width = `${size}px`;
    b.style.height = `${size}px`;
    b.style.left = `${img.offsetLeft + w - size - inset}px`;
    b.style.top = `${img.offsetTop + inset}px`;
  }

  function ensureBadge(img, status) {
    const parent = img.parentElement;
    if (!parent) return;
    let b = badges.get(img);
    if (b && b.parentElement !== parent) {
      removeBadge(img);
      b = null;
    }
    if (!b) {
      b = document.createElement("span");
      b.className = "tk-badge";
      img.insertAdjacentElement("afterend", b);
      badges.set(img, b);
      if (resizeObs) resizeObs.observe(img);
    }
    if (b.dataset.status !== status) {
      b.dataset.status = status;
      b.innerHTML = badgeSVG(status);
    }
    placeBadge(img);
  }

  function sweepBadges() {
    for (const img of [...badges.keys()]) {
      if (!badgeMode || !img.isConnected || !img.dataset.tkStatus) removeBadge(img);
      else placeBadge(img);
    }
  }

  function syncBadge(img) {
    if (badgeMode && img.dataset.tkStatus) ensureBadge(img, img.dataset.tkStatus);
    else removeBadge(img);
  }

  // ----------------------------------------------- marking icons

  function clear(img) {
    delete img.dataset.tkItem;
    delete img.dataset.tkStatus;
    removeBadge(img);
  }

  function apply(img, item) {
    const entry = result?.entries.get(item);
    if (entry) img.dataset.tkStatus = entry.status;
    else delete img.dataset.tkStatus;
    syncBadge(img);
  }

  function consider(img) {
    const key = keyOf(img);
    if (!key || !inScope(img)) return clear(img);
    const item = itemForKey(key);
    if (!item) return clear(img);
    img.dataset.tkItem = item.id;
    apply(img, item);
  }

  function scan(root) {
    if (root instanceof HTMLImageElement) return consider(root);
    root.querySelectorAll?.("img").forEach(consider);
  }

  function queue(node) {
    pending.add(node);
    if (flushQueued) return;
    flushQueued = true;
    requestAnimationFrame(() => {
      flushQueued = false;
      for (const n of pending) if (n.isConnected) scan(n);
      pending.clear();
      if (badges.size) sweepBadges();
    });
  }

  function refresh(newResult) {
    result = newResult;
    document.querySelectorAll("img[data-tk-item]").forEach((img) => {
      const item = A.findItem(img.dataset.tkItem);
      if (item) apply(img, item);
    });
    sweepBadges();
    if (tipTarget) renderTip(tipTarget);
    renderBankTab();
  }

  function rescanAll() {
    scan(document.body);
  }

  // ----------------------------------------------- tooltip section

  const fmt = (n) => Math.round(n).toLocaleString();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (item, cls = "tk-ico") => `<img class="${cls}" src="${esc(item.media)}" alt="${esc(item.name)}">`;

  const LOCK_SVG =
    '<svg class="tk-lock" viewBox="0 0 16 16" aria-label="locked"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5A1 1 0 0 1 13 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h.5zm1.5 0h4V5a2 2 0 0 0-4 0v2z" fill="currentColor"/></svg>';
  let lockHTML = null;

  // Use the game's Font Awesome lock when it is loaded, else our own SVG.
  function lock() {
    if (lockHTML !== null) return lockHTML;
    lockHTML = LOCK_SVG;
    try {
      const probe = document.createElement("i");
      probe.className = "fa fa-lock";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);
      const before = getComputedStyle(probe, "::before").content;
      const family = getComputedStyle(probe).fontFamily || "";
      probe.remove();
      if (before && before !== "none" && before !== "normal" && /awesome/i.test(family)) {
        lockHTML = '<i class="fa fa-lock tk-lock tk-lock-fa" aria-label="locked"></i>';
      }
    } catch (e) {}
    return lockHTML;
  }

  const compact = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : fmt(n));
  const goalIcon = (media, name) => (media ? `<img class="tk-ico tk-goal-ico" src="${esc(media)}" alt="${esc(name)}" title="${esc(name)}">` : "");

  // A task without a description is shown by its other goals.
  function goalChips(task, item) {
    const MAX = 4;
    const goals = A.taskGoals(task).filter((g) => !(g.item && g.item === item) && !(g.items && g.items.includes(item)));
    const chips = goals.slice(0, MAX).map((g) => {
      if (g.kind === "text") return `<span class="tk-goal">${esc(g.text)}</span>`;
      const suffix = g.kind === "skill" ? " XP" : "";
      const extra = g.kind === "equip" ? g.items.map((i) => goalIcon(i.media, i.name)).join("") : "";
      return `<span class="tk-goal">${goalIcon(g.media, g.name)}${extra}${compact(g.qty)}${suffix}</span>`;
    });
    if (goals.length > MAX) chips.push(`<span class="tk-goal tk-goal-more">+${goals.length - MAX}</span>`);
    return chips.join("");
  }

  function taskLabel(line, item) {
    const desc = A.taskName(line.task);
    let lead;
    if (line.kind === "casual") lead = "Casual Task";
    else if (line.kind === "pool") lead = "Casual Task Pool";
    else lead = A.taskTier(line.task) || "";
    const what = desc ? esc(desc) : goalChips(line.task, item);
    const parts = [lead ? `<span class="tk-tier">${esc(lead)}</span>` : "", what].filter(Boolean);
    return parts.join(" · ");
  }

  function requirement(line) {
    if (line.mode === "equip") {
      const who = line.monster && line.monster.name ? ` ${esc(line.monster.name)}` : "";
      return `equipped, ${fmt(line.kills)}${who}`;
    }
    return fmt(line.qty);
  }

  // With `links`, task labels become links into Township; each linked line
  // is pushed onto `links` and found again by its index when clicked. Pool
  // tasks aren't shown anywhere in Township, so they stay plain text.
  function row(lead, line, item, links) {
    let label = taskLabel(line, item);
    if (links && line.kind !== "pool") {
      label = `<a href="#" class="tk-task-link" data-tk-line="${links.length}">${label}</a>`;
      links.push(line);
    }
    return `<div class="tk-row">${lead}<span class="tk-task">${label}</span><span class="tk-req">${requirement(line)}</span></div>`;
  }

  const MAX_LINES = 8;

  function sectionHTML(item, { max = MAX_LINES, links } = {}) {
    const entry = item && result && result.entries.get(item);
    if (!entry) return "";
    const d = model.describe(item, result, A);
    let budget = max;
    let total = d.direct.length;
    for (const g of d.groups) total += g.lines.length;

    let html = "";
    for (const line of d.direct) {
      if (budget-- <= 0) break;
      html += row("", line, item, links);
    }
    for (const g of d.groups) {
      if (budget <= 0) break;
      html += `<div class="tk-group">${icon(g.final)}<span>${esc(g.final.name)}</span></div>`;
      for (const line of g.lines) {
        if (budget-- <= 0) break;
        const chain = line.chain.map((i) => icon(i)).join('<span class="tk-arrow">→</span>');
        html += row(`<span class="tk-chain">${chain}${line.locked ? lock() : ""}</span>`, line, g.final, links);
      }
    }
    const shown = max - Math.max(budget, 0);
    if (total > shown) html += `<div class="tk-more">+${total - shown} more</div>`;
    return `<div class="tk-section" data-status="${entry.status}">${html}</div>`;
  }

  // ----------------------------------------------- bank sidebar tab

  // A "Tasks" tab beside the bank sidebar's item, stats and settings tabs,
  // showing the tooltip's content for the selected item with links into
  // Township.
  const TASKS_ICON = "assets/media/skills/township/menu_tasks.png";
  const BANK_TAB_LINES = 40;
  let bankTab = null;

  function mediaURL(path) {
    try {
      if (typeof assets !== "undefined" && assets.getURI) return assets.getURI(path);
    } catch (e) {}
    return path;
  }

  function installBankTab(sidebar) {
    if (bankTab || !sidebar) return false;
    const nav = sidebar.querySelector("ul.nav");
    const panes = sidebar.paneContainer ?? sidebar.querySelector(".tab-content");
    if (!nav || !panes) return false;

    const li = document.createElement("li");
    li.className = "nav-item";
    li.innerHTML = `<a class="nav-link" href="#tk-bank-tasks-tab" title="Township tasks"><img class="skill-icon-xs m-1" src="${esc(mediaURL(TASKS_ICON))}" alt="Township tasks"></a>`;
    nav.appendChild(li);
    const link = li.firstElementChild;

    const pane = document.createElement("div");
    pane.className = "tab-pane";
    pane.id = "tk-bank-tasks-tab";
    pane.setAttribute("role", "tabpanel");
    const close = sidebar.sidebarCloseButton;
    if (close && close.parentElement === panes) panes.insertBefore(pane, close);
    else panes.appendChild(pane);

    // The game wires up its tab links once at startup, so this one needs its
    // own handler. Bootstrap's tab plugin also deactivates the other tabs.
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const $ = globalThis.jQuery;
      if ($?.fn?.tab) return $(link).tab("show");
      for (const a of nav.querySelectorAll(".nav-link.active")) a.classList.remove("active");
      for (const p of panes.querySelectorAll(":scope > .tab-pane.active")) p.classList.remove("active", "show");
      link.classList.add("active");
      pane.classList.add("active", "show");
    });

    pane.addEventListener("click", (e) => {
      const a = e.target.closest?.("a.tk-task-link");
      if (!a) return;
      e.preventDefault();
      const line = bankTab.lines[Number(a.dataset.tkLine)];
      if (line) A.openTownshipTask(line.task, line.kind === "casual");
    });

    bankTab = { pane, item: A.selectedBankItem(), lines: [] };
    renderBankTab();
    return true;
  }

  function setBankItem(item) {
    if (!bankTab) return;
    bankTab.item = item;
    renderBankTab();
  }

  function renderBankTab() {
    if (!bankTab) return;
    const item = bankTab.item;
    const lines = [];
    const header = `<div class="tk-bank-title"><img class="skill-icon-xs mr-2" src="${esc(mediaURL(TASKS_ICON))}" alt="">Township tasks</div>`;
    let body;
    if (!item) {
      body = `<div class="tk-bank-note">Select an item to see which Township tasks need it.</div>`;
    } else if (!result) {
      body = `<div class="tk-bank-note">Working out what your tasks need…</div>`;
    } else {
      const entry = result.entries.get(item);
      if (!entry) {
        body = `<div class="tk-bank-note">No Township task needs ${esc(item.name)}.</div>`;
      } else {
        const held = entry.equipped ? `${fmt(entry.holdings)} (${fmt(entry.equipped)} equipped)` : fmt(entry.holdings);
        body =
          `<div class="tk-bank-stats">` +
          `<span>Keep <strong>${fmt(entry.keep)}</strong></span>` +
          `<span>Have <strong>${held}</strong></span>` +
          `<span>Spare <strong>${fmt(entry.safe)}</strong></span>` +
          `</div>` +
          sectionHTML(item, { max: BANK_TAB_LINES, links: lines });
      }
    }
    bankTab.lines = lines;
    bankTab.pane.innerHTML = `<div class="tk-bank-tab">${header}${body}</div>`;
  }

  // ----------------------------------------------- game tooltips (tippy)

  // A tippy plugin appends our section to the game's own item tooltips, so
  // there is one tooltip rather than two.
  const PLUGIN = {
    name: "taskKeeper",
    fn: (instance) => ({
      onShow() {
        decorateGameTip(instance);
      },
      onAfterUpdate() {
        decorateGameTip(instance);
      }
    })
  };

  function iconFor(el) {
    if (!el || !el.querySelectorAll) return null;
    if (el.matches("img[data-tk-status]")) return el;
    const found = el.querySelectorAll("img[data-tk-status]");
    return found.length === 1 ? found[0] : null;
  }

  function decorateGameTip(instance) {
    const box = instance.popper && instance.popper.querySelector(".tippy-content");
    if (!box) return;
    const old = box.querySelector(":scope > .tk-section");
    const img = iconFor(instance.reference);
    const html = img ? sectionHTML(A.findItem(img.dataset.tkItem)) : "";
    if (old) old.remove();
    if (html) box.insertAdjacentHTML("beforeend", html);
  }

  function installTippyPlugin() {
    const t = globalThis.tippy;
    if (!t || typeof t.setDefaultProps !== "function") return false;
    const current = (t.defaultProps && t.defaultProps.plugins) || [];
    t.setDefaultProps({ plugins: [...current, PLUGIN] });
    return true;
  }

  function hasGameTip(img) {
    for (let el = img, depth = 0; el && el !== document.body && depth < 6; el = el.parentElement, depth++) {
      const inst = el._tippy;
      if (inst && iconFor(el) === img) {
        const plugins = (inst.props && inst.props.plugins) || [];
        if (plugins.includes(PLUGIN)) return true;
      }
    }
    return false;
  }

  // ----------------------------------------------- fallback tooltip

  function renderTip(img) {
    const item = A.findItem(img.dataset.tkItem);
    const html = sectionHTML(item);
    if (!html) return hideTip();
    tip.innerHTML = `<div class="tk-title">${icon(item)}<span>${esc(item.name)}</span></div>${html}`;
    tip.hidden = false;
    position(img);
  }

  function position(img) {
    const r = img.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    const vv = window.visualViewport;
    const vx = vv ? vv.offsetLeft : 0;
    const vy = vv ? vv.offsetTop : 0;
    const vw = vv ? vv.width : innerWidth;
    const vh = vv ? vv.height : innerHeight;
    let top = r.bottom + gap;
    if (top + t.height > vy + vh - gap) top = Math.max(vy + gap, r.top - t.height - gap);
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.min(Math.max(vx + gap, left), vx + vw - t.width - gap);
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  function hideTip() {
    tip.hidden = true;
    tipTarget = null;
  }

  // The marked icon under (or within NEAR px of) the pointer, if exactly one.
  const NEAR = 12;
  function iconAt(el, x, y) {
    for (let cur = el, depth = 0; cur && cur !== document.body && depth < 5; cur = cur.parentElement, depth++) {
      if (cur.id === "tk-tooltip" || cur.classList.contains("tk-section")) return null;
      let found;
      if (cur.matches("img[data-tk-status]")) found = [cur];
      else found = cur.querySelectorAll("img[data-tk-status]");
      if (found.length > 1) return null;
      if (found.length === 1) {
        const r = found[0].getBoundingClientRect();
        const near = x >= r.left - NEAR && x <= r.right + NEAR && y >= r.top - NEAR && y <= r.bottom + NEAR;
        return near ? found[0] : null;
      }
    }
    return null;
  }

  function show(img) {
    if (img === tipTarget) return;
    if (!img || hasGameTip(img)) return hideTip();
    tipTarget = img;
    renderTip(img);
  }

  // Touch: tap an icon to show, tap anywhere else to hide. Mouse events that
  // browsers synthesise after a tap are ignored.
  let lastTouch = 0;
  const recentTouch = () => Date.now() - lastTouch < 800;

  let moveQueued = false;
  let lastMove = null;
  function onMove(e) {
    if (recentTouch()) return;
    lastMove = e;
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      const m = lastMove;
      show(iconAt(m.target, m.clientX, m.clientY));
    });
  }

  function onPointerDown(e) {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    onTap(e.target, e.clientX, e.clientY);
  }

  function onTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (t) onTap(e.target, t.clientX, t.clientY);
  }

  function onTap(target, x, y) {
    lastTouch = Date.now();
    const img = iconAt(target, x, y);
    if (img && img !== tipTarget) show(img);
    else hideTip();
  }

  function onLeaveWindow(e) {
    if (!e.relatedTarget) hideTip();
  }

  // ----------------------------------------------- lifecycle and settings

  function start() {
    mediaIndex = A.buildMediaIndex();
    pages = A.venuePages();
    tip.hidden = true;
    document.body.appendChild(tip);
    document.addEventListener("mousemove", onMove, { capture: true, passive: true });
    document.addEventListener("mouseout", onLeaveWindow, true);
    if (typeof PointerEvent !== "undefined") {
      document.addEventListener("pointerdown", onPointerDown, true);
    } else {
      document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    }
    addEventListener("scroll", hideTip, true);

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes") {
          if (m.target instanceof HTMLImageElement) queue(m.target);
        } else {
          for (const n of m.addedNodes) if (n.nodeType === 1 && n.id !== "tk-tooltip" && !(n.classList && n.classList.contains("tk-badge"))) queue(n);
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
    rescanAll();
  }

  function setVenue(key, on) {
    enabled[key] = on;
    if (observer) rescanAll();
  }

  function setPalette(name) {
    document.body.classList.toggle("tk-palette-cb", name === "cb");
  }

  function setStyle(name) {
    badgeMode = name === "badge";
    document.body.classList.toggle("tk-style-badge", badgeMode);
    document.querySelectorAll("img[data-tk-status]").forEach(syncBadge);
    sweepBadges();
  }

  // Note in the bulk-sell confirmation which selected items tasks still need.
  function annotateSellDialog(items) {
    if (!enabled.bank || !result) return;
    const kept = items.filter((i) => result.entries.has(i));
    if (!kept.length) return;
    const popup = document.querySelector(".swal2-popup");
    const body = popup && (popup.querySelector(".swal2-html-container") || popup.querySelector(".swal2-content"));
    if (!body || body.querySelector(".tk-sell-note")) return;
    const names =
      kept
        .slice(0, 6)
        .map((i) => esc(i.name))
        .join(", ") + (kept.length > 6 ? `, +${kept.length - 6} more` : "");
    const n = kept.length;
    body.insertAdjacentHTML("beforeend", `<div class="tk-sell-note">${n} selected item${n === 1 ? " is" : "s are"} kept for tasks: ${names}</div>`);
  }

  return { start, refresh, setVenue, setPalette, setStyle, annotateSellDialog, installTippyPlugin, sectionHTML, installBankTab, setBankItem };
}
