// Plinth's element picker, loaded into a story only on this computer (see the template's .storybook/preview.tsx).
// The Plinth UI turns it on with a message; then hovering outlines an element and a click reports the classes of the
// element and of its parents (the UI maps them to tokens) without the click reaching the story, so buttons and links
// do not act while picking. Escape tells the UI to stop picking. It talks only to the Plinth UI that served it.
(() => {
  if (window.__plinthInspect) return;
  window.__plinthInspect = true;
  const ui = new URL(document.currentScript.src).origin;
  const send = (msg) => window.parent.postMessage({ source: "plinth-inspect", ...msg }, ui);
  let on = false, hovered = null, picked = null;
  const frame = (color, style) => {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, { position: "fixed", pointerEvents: "none", zIndex: "2147483647", border: `2px ${style} ${color}`, borderRadius: "4px", display: "none", boxSizing: "border-box" });
    document.documentElement.append(el);
    return el;
  };
  const hover = frame("#2563eb", "dashed"), chosen = frame("#2563eb", "solid");
  const place = (box, el) => {
    if (!el || !el.isConnected) { box.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
  };
  const classesOf = (n) => n.getAttribute?.("class") ?? "";
  // What a click picks: the element itself, unless it is a bare wrapper inside a part (an SVG path, a text span).
  const target = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) if (n.dataset?.slot || /(^|\s)(bg|text|border|rounded|type|fill|stroke|ring)-/.test(classesOf(n))) return n;
    return el;
  };
  const chain = (el) => {
    const out = [];
    for (let n = el; n && n !== document.body && out.length < 10; n = n.parentElement) out.push({ slot: n.dataset?.slot ?? null, tag: n.tagName.toLowerCase(), classes: classesOf(n) });
    return out;
  };
  const stop = (e) => { if (!on) return; e.preventDefault(); e.stopPropagation(); };
  addEventListener("mousemove", (e) => { if (!on) return; hovered = target(e.target); place(hover, hovered); }, true);
  addEventListener("scroll", () => { place(hover, on ? hovered : null); place(chosen, picked); }, true);
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick"]) addEventListener(type, stop, true);
  addEventListener("click", (e) => {
    if (!on) return;
    stop(e);
    picked = target(e.target);
    place(chosen, picked);
    // On the page with every component (data-sheet sections), which component's section the click was in.
    send({ type: "pick", chain: chain(picked), text: (picked.innerText || picked.getAttribute("aria-label") || "").trim().slice(0, 60), sheet: picked.closest("[data-sheet]")?.dataset.sheet ?? null });
  }, true);
  addEventListener("keydown", (e) => { if (on && e.key === "Escape") send({ type: "cancel" }); }, true);
  addEventListener("message", (e) => {
    if (e.origin !== ui || e.data?.source !== "plinth-ui") return;
    if (e.data.type === "inspect") {
      on = !!e.data.on;
      document.documentElement.style.cursor = on ? "crosshair" : "";
      if (!on) { hovered = null; picked = null; place(hover, null); place(chosen, null); }
    }
    // Where a token is used (the Style map): only these components' sections, these classes outlined. null shows all.
    if (e.data.type === "focus") { focus = { sheets: Array.isArray(e.data.sheets) ? e.data.sheets : null, classes: Array.isArray(e.data.classes) ? e.data.classes : [] }; applyFocus(true); }
    // Bring one component's section into view and mark it (the UI's list of components).
    if (e.data.type === "reveal" && typeof e.data.sheet === "string") {
      const section = [...document.querySelectorAll("[data-sheet]")].find((s) => s.dataset.sheet === e.data.sheet);
      if (!section) return;
      section.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      picked = section;
      place(chosen, picked);
    }
  });
  // The focus is applied again when the page changes (the page of every component renders after loading its stories).
  let focus = null;
  const marks = document.createElement("style");
  document.head.append(marks);
  const applyFocus = (scroll) => {
    if (!focus) return;
    const only = focus.sheets ? new Set(focus.sheets) : null;
    for (const s of document.querySelectorAll("[data-sheet]")) s.style.display = !only || only.has(s.dataset.sheet) ? "" : "none";
    for (const g of document.querySelectorAll("[data-sheet-group]")) g.style.display = [...g.querySelectorAll("[data-sheet]")].some((s) => s.style.display !== "none") ? "" : "none";
    const selector = focus.classes.map((c) => `[class~="${CSS.escape(c)}"]`).join(",");
    const css = selector ? `${selector}{outline:2px solid #2563eb !important;outline-offset:2px !important}` : "";
    if (marks.textContent !== css) marks.textContent = css;
    if (!scroll) return;
    const target = (selector && document.querySelector(selector)) || document.querySelector("[data-sheet]:not([style*='none'])");
    if (target) { target.scrollIntoView({ block: "center" }); pending = false; } else pending = true;
  };
  let queued = false, pending = false;
  new MutationObserver(() => { if (!focus || queued) return; queued = true; requestAnimationFrame(() => { queued = false; applyFocus(pending); }); }).observe(document.body, { childList: true, subtree: true });
  send({ type: "ready" });
})();
