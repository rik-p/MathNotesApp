/* global math */
(function () {
  "use strict";

  const APP_VERSION = "1.2.0";
  const STORAGE_KEY = "math-notes-app-v1";
  const DEFAULT_TITLE = "Nuova pagina";
  const DEFAULT_SETTINGS = { theme: "system", palette: "sage", precision: 12 };
  const PALETTES = new Set(["sage", "bordeaux", "midnight", "plum"]);
  const THEMES = new Set(["system", "light", "dark"]);
  let state = loadState();
  let focusedCellId = null;
  let toastTimer;
  let saveTimer;
  let updateRequested = false;
  let mathConfigured = false;
  let insertionTarget = { cellId: null, start: 0, end: 0 };
  let rowDrag = null;

  const els = {
    pageList: document.getElementById("pageList"),
    cells: document.getElementById("cells"),
    pageTitle: document.getElementById("pageTitle"),
    pageMeta: document.getElementById("pageMeta"),
    saveState: document.getElementById("saveState"),
    toastRegion: document.getElementById("toastRegion"),
    importFile: document.getElementById("importFile"),
    sidebar: document.querySelector(".sidebar"),
    settingsDialog: document.getElementById("settingsDialog"),
    paletteSetting: document.getElementById("paletteSetting"),
    themeSetting: document.getElementById("themeSetting"),
    precisionSetting: document.getElementById("precisionSetting"),
    appVersion: document.getElementById("appVersion"),
  };

  function uid() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function exampleCells() {
    return [
      { id: uid(), expression: "r = 3" },
      { id: uid(), expression: "h = 8" },
      { id: uid(), expression: "V = π × r² × h" },
      { id: uid(), expression: "V" },
    ];
  }

  function newPage(title = DEFAULT_TITLE, cells = exampleCells()) {
    const now = new Date().toISOString();
    return { id: uid(), title, cells, createdAt: now, updatedAt: now };
  }

  function defaultState() {
    const page = newPage("Primi calcoli");
    return { version: 1, settings: { ...DEFAULT_SETTINGS }, activePageId: page.id, pages: [page] };
  }

  function normalizeState(candidate) {
    if (!candidate || !Array.isArray(candidate.pages) || !candidate.pages.length) return defaultState();
    const settings = { ...DEFAULT_SETTINGS, ...(candidate.settings || {}) };
    if (!THEMES.has(settings.theme)) settings.theme = DEFAULT_SETTINGS.theme;
    if (!PALETTES.has(settings.palette)) settings.palette = DEFAULT_SETTINGS.palette;
    settings.precision = [6, 10, 12, 14].includes(Number(settings.precision))
      ? Number(settings.precision)
      : DEFAULT_SETTINGS.precision;

    const pages = candidate.pages.map((page) => ({
      id: page.id || uid(),
      title: String(page.title || DEFAULT_TITLE),
      createdAt: page.createdAt || new Date().toISOString(),
      updatedAt: page.updatedAt || new Date().toISOString(),
      sliders: normalizeSliders(page.sliders),
      cells: Array.isArray(page.cells) && page.cells.length
        ? page.cells.map((cell) => ({ id: cell.id || uid(), expression: String(cell.expression ?? "") }))
        : [{ id: uid(), expression: "" }],
    }));
    const activePageId = pages.some((page) => page.id === candidate.activePageId)
      ? candidate.activePageId
      : pages[0].id;
    return { version: 1, settings, activePageId, pages };
  }

  function normalizeSliders(candidate) {
    if (!candidate || typeof candidate !== "object") return {};
    return Object.fromEntries(Object.entries(candidate).flatMap(([cellId, config]) => {
      const min = Number(config?.min);
      const max = Number(config?.max);
      const step = Number(config?.step);
      if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || min >= max || step <= 0) return [];
      return [[cellId, { min, max, step }]];
    }));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("Impossibile leggere le note locali", error);
      return defaultState();
    }
  }

  function activePage() {
    return state.pages.find((page) => page.id === state.activePageId) || state.pages[0];
  }

  function applyTheme() {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedTheme = state.settings.theme === "system"
      ? (prefersDark ? "dark" : "light")
      : state.settings.theme;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.palette = state.settings.palette;
  }

  function syncSettingsUi() {
    els.paletteSetting.value = state.settings.palette;
    els.themeSetting.value = state.settings.theme;
    els.precisionSetting.value = String(state.settings.precision);
    els.appVersion.textContent = `Math Notes · Versione ${APP_VERSION}`;
  }

  function persist() {
    clearTimeout(saveTimer);
    els.saveState.textContent = "Salvataggio…";
    saveTimer = window.setTimeout(() => {
      try {
        state = normalizeState(state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        els.saveState.textContent = "Salvato";
      } catch (error) {
        els.saveState.textContent = "Non salvato";
        showToast("Spazio locale esaurito: esporta le tue note.");
      }
    }, 180);
  }

  function formatDate(date) {
    try {
      return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
    } catch (_) {
      return "oggi";
    }
  }

  function normalizedExpression(value) {
    const superscripts = { "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5", "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9" };
    return value
      .replace(/€\s*(\d+(?:[.,]\d+)?)/g, "$1 EUR")
      .replace(/(\d+(?:[.,]\d+)?)\s*€/g, "$1 EUR")
      .replaceAll("€", "EUR")
      .replace(/(\d),(\d)/g, "$1.$2")
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (character) => superscripts[character])
      .replaceAll("×", "*")
      .replaceAll("÷", "/")
      .replaceAll("−", "-")
      .replaceAll("π", "pi")
      .replaceAll("√", "sqrt")
      .replace(/\bln\s*\(/g, "log(")
      .trim();
  }

  function assignmentName(expression) {
    return expression.match(/^\s*([A-Za-z_À-ÿ][\wÀ-ÿ]*)\s*=/)?.[1] || null;
  }

  function numericAssignment(expression) {
    const match = expression.trim().match(/^([A-Za-z_À-ÿ][\wÀ-ÿ]*)\s*=\s*(-?(?:\d+(?:[.,]\d*)?|[.,]\d+))$/);
    if (!match) return null;
    const value = Number(match[2].replace(",", "."));
    return Number.isFinite(value) ? { name: match[1], value } : null;
  }

  function defaultSlider(value) {
    const magnitude = Math.max(Math.abs(value), 1);
    const span = Math.max(magnitude * 2, 10);
    return {
      min: value < 0 ? -span : 0,
      max: value < 0 ? 0 : span,
      step: span >= 100 ? 1 : span >= 10 ? 0.1 : 0.01,
    };
  }

  function displayNumber(value) {
    return Number(value.toFixed(10)).toString();
  }

  function preferredUnitForExpression(expression, preferences) {
    const compoundUnit = expression.match(/\b([A-Za-zµ]+)\s*\/\s*([A-Za-zµ]+)\b/);
    if (compoundUnit) {
      const numerator = compoundUnit[1];
      const denominator = compoundUnit[2] === "L" ? "l" : compoundUnit[2];
      return `${numerator} / ${denominator}`;
    }
    const symbols = expression.match(/[A-Za-z_À-ÿ][\wÀ-ÿ]*/g) || [];
    return symbols.map((symbol) => preferences.get(symbol)).find(Boolean) || null;
  }

  function configureMathEngine() {
    if (mathConfigured || typeof math === "undefined") return;
    try {
      // Un'unità base mantiene gli euro compatibili con somme, prodotti e variabili.
      math.createUnit("EUR");
    } catch (_) {
      // L'unità può essere già presente se il motore è stato inizializzato altrove.
    }
    mathConfigured = true;
  }

  function friendlyError(error) {
    const message = String(error && error.message ? error.message : error);
    if (/Undefined symbol/.test(message)) return "Variabile non definita";
    if (/Unexpected end/.test(message)) return "Espressione incompleta";
    if (/Parenthesis/.test(message)) return "Controlla le parentesi";
    if (/Cannot create unit/.test(message)) return "Unità non riconosciuta";
    return "Controlla la sintassi";
  }

  function formatResult(value, preferredUnit = null) {
    if (typeof value === "undefined") return "";
    if (typeof math === "undefined") return "Motore non disponibile";
    try {
      const valueForDisplay = preferredUnit && typeof value?.to === "function"
        ? value.to(preferredUnit)
        : value;
      return math.format(valueForDisplay, { precision: state.settings.precision, lowerExp: -7, upperExp: 12 })
        .replace(/\bEUR\b/g, "€")
        .replace(/\s\/\sl\b/g, " / L");
    } catch (_) {
      return String(value);
    }
  }

  function calculatePage(page) {
    const results = new Map();
    if (typeof math === "undefined") {
      page.cells.forEach((cell) => results.set(cell.id, { error: "Motore non disponibile" }));
      return results;
    }
    configureMathEngine();
    const parser = math.parser();
    const unitPreferences = new Map();
    page.cells.forEach((cell) => {
      const raw = cell.expression.trim();
      if (!raw || raw.startsWith("#") || raw.startsWith("//")) {
        results.set(cell.id, { text: "" });
        return;
      }
      try {
        const value = parser.evaluate(normalizedExpression(raw));
        const preferredUnit = preferredUnitForExpression(raw, unitPreferences);
        const name = assignmentName(raw);
        if (name && preferredUnit) unitPreferences.set(name, preferredUnit);
        results.set(cell.id, { text: formatResult(value, preferredUnit) });
      } catch (error) {
        results.set(cell.id, { error: friendlyError(error) });
      }
    });
    return results;
  }

  function renderPages() {
    els.pageList.replaceChildren();
    state.pages.forEach((page) => {
      const button = document.createElement("button");
      button.className = `page-item${page.id === state.activePageId ? " active" : ""}`;
      button.type = "button";
      button.dataset.pageId = page.id;
      const icon = document.createElement("span");
      icon.className = "page-icon";
      icon.textContent = "◰";
      const name = document.createElement("span");
      name.className = "page-item-name";
      name.textContent = page.title || DEFAULT_TITLE;
      button.append(icon, name);
      els.pageList.append(button);
    });
  }

  function renderCells() {
    const page = activePage();
    const results = calculatePage(page);
    els.cells.replaceChildren();
    page.cells.forEach((cell, index) => {
      const row = document.createElement("div");
      row.className = "cell";
      row.dataset.cellId = cell.id;

      const dragHandle = document.createElement("button");
      dragHandle.className = "drag-handle";
      dragHandle.type = "button";
      dragHandle.dataset.dragCell = cell.id;
      dragHandle.setAttribute("aria-label", `Sposta riga ${index + 1}`);
      dragHandle.title = "Trascina per spostare la riga";
      dragHandle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h12"/></svg>';

      const input = document.createElement("input");
      input.className = "expression";
      input.type = "text";
      input.value = cell.expression;
      input.placeholder = index === 0 ? "es. x = 12" : "scrivi un calcolo…";
      input.setAttribute("spellcheck", "false");
      input.setAttribute("aria-label", `Espressione riga ${index + 1}`);
      if (focusedCellId === cell.id) requestAnimationFrame(() => input.focus());

      const result = document.createElement("output");
      const current = results.get(cell.id) || {};
      result.className = "result";
      if (current.error) {
        result.classList.add("error");
        result.textContent = current.error;
        result.title = current.error;
      } else if (current.text) {
        result.textContent = `= ${current.text}`;
        result.title = current.text;
      } else {
        result.classList.add("empty");
        result.textContent = "—";
      }

      const remove = document.createElement("button");
      remove.className = "cell-remove";
      remove.type = "button";
      remove.dataset.removeCell = cell.id;
      remove.setAttribute("aria-label", `Elimina riga ${index + 1}`);
      remove.textContent = "×";

      const numeric = numericAssignment(cell.expression);
      const sliderToggle = document.createElement("button");
      sliderToggle.className = `cell-slider-toggle${numeric ? " available" : ""}${page.sliders?.[cell.id] ? " active" : ""}`;
      sliderToggle.type = "button";
      sliderToggle.dataset.toggleSlider = cell.id;
      sliderToggle.setAttribute("aria-label", page.sliders?.[cell.id] ? "Rimuovi slider" : "Aggiungi slider");
      sliderToggle.title = page.sliders?.[cell.id] ? "Rimuovi slider" : "Aggiungi slider";
      sliderToggle.textContent = "↔";

      row.append(dragHandle, input, result, sliderToggle, remove);

      if (numeric && page.sliders?.[cell.id]) {
        const config = page.sliders[cell.id];
        const panel = document.createElement("div");
        panel.className = "slider-panel";
        panel.dataset.sliderPanel = cell.id;

        const range = document.createElement("input");
        range.type = "range";
        range.min = String(config.min);
        range.max = String(config.max);
        range.step = String(config.step);
        range.value = String(Math.min(config.max, Math.max(config.min, numeric.value)));
        range.dataset.sliderValue = cell.id;
        range.setAttribute("aria-label", `Valore di ${numeric.name}`);

        const value = document.createElement("output");
        value.className = "slider-value";
        value.dataset.sliderDisplay = cell.id;
        value.textContent = displayNumber(numeric.value);

        const minLabel = sliderLimit("Min", "min", cell.id, config.min);
        const maxLabel = sliderLimit("Max", "max", cell.id, config.max);
        const stepLabel = sliderLimit("Passo", "step", cell.id, config.step);
        panel.append(range, value, minLabel, maxLabel, stepLabel);
        row.append(panel);
      }
      els.cells.append(row);
    });
  }

  function render({ preserveFocus = false } = {}) {
    if (!preserveFocus) focusedCellId = null;
    const page = activePage();
    els.pageTitle.value = page.title;
    els.pageMeta.textContent = `Modificata ${formatDate(page.updatedAt)} · ${page.cells.length} ${page.cells.length === 1 ? "riga" : "righe"}`;
    renderPages();
    renderCells();
  }

  function updateCell(id, expression) {
    const page = activePage();
    const cell = page.cells.find((item) => item.id === id);
    if (!cell) return;
    cell.expression = expression;
    if (page.sliders?.[id] && !numericAssignment(expression)) delete page.sliders[id];
    page.updatedAt = new Date().toISOString();
    persist();
    focusedCellId = id;
    render({ preserveFocus: true });
  }

  function addLine(afterId) {
    const page = activePage();
    const cell = { id: uid(), expression: "" };
    const index = afterId ? page.cells.findIndex((item) => item.id === afterId) : page.cells.length - 1;
    page.cells.splice(index + 1, 0, cell);
    page.updatedAt = new Date().toISOString();
    focusedCellId = cell.id;
    persist();
    render({ preserveFocus: true });
  }

  function removeLine(id) {
    const page = activePage();
    if (page.cells.length === 1) {
      page.cells[0].expression = "";
      focusedCellId = page.cells[0].id;
    } else {
      const index = page.cells.findIndex((cell) => cell.id === id);
      page.cells.splice(index, 1);
      focusedCellId = page.cells[Math.max(0, index - 1)].id;
    }
    if (page.sliders) delete page.sliders[id];
    page.updatedAt = new Date().toISOString();
    persist();
    render({ preserveFocus: true });
  }

  function sliderLimit(label, field, cellId, value) {
    const wrapper = document.createElement("label");
    wrapper.className = "slider-limit";
    wrapper.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.value = String(value);
    input.dataset.sliderLimit = field;
    input.dataset.cellId = cellId;
    input.setAttribute("aria-label", `${label} slider`);
    wrapper.append(input);
    return wrapper;
  }

  function refreshResults(page = activePage()) {
    const results = calculatePage(page);
    page.cells.forEach((entry) => {
      const output = els.cells.querySelector(`[data-cell-id="${entry.id}"] .result`);
      const current = results.get(entry.id) || {};
      if (!output) return;
      output.className = "result";
      if (current.error) {
        output.classList.add("error");
        output.textContent = current.error;
        output.title = current.error;
      } else if (current.text) {
        output.textContent = `= ${current.text}`;
        output.title = current.text;
      } else {
        output.classList.add("empty");
        output.textContent = "—";
        output.title = "";
      }
    });
  }

  function addPage() {
    const page = newPage();
    state.pages.unshift(page);
    state.activePageId = page.id;
    persist();
    render();
    els.pageTitle.focus();
    els.pageTitle.select();
    closeSidebar();
  }

  function duplicatePage() {
    const source = activePage();
    const copy = newPage(`${source.title} — copia`, source.cells.map((cell) => ({ id: uid(), expression: cell.expression })));
    state.pages.unshift(copy);
    state.activePageId = copy.id;
    persist();
    render();
    showToast("Pagina duplicata");
  }

  function deletePage() {
    const page = activePage();
    if (!window.confirm(`Eliminare “${page.title}”? Questa azione non si può annullare.`)) return;
    if (state.pages.length === 1) {
      const fresh = newPage();
      state.pages = [fresh];
      state.activePageId = fresh.id;
    } else {
      state.pages = state.pages.filter((item) => item.id !== page.id);
      state.activePageId = state.pages[0].id;
    }
    persist();
    render();
    showToast("Pagina eliminata");
  }

  function insertAtCursor(text, relativeCaret) {
    const input = insertionTarget.cellId
      ? els.cells.querySelector(`[data-cell-id="${insertionTarget.cellId}"] .expression`)
      : (document.activeElement?.classList.contains("expression") ? document.activeElement : els.cells.querySelector(".expression"));
    if (!input) return;
    const isStoredTarget = input.closest(".cell").dataset.cellId === insertionTarget.cellId;
    const start = isStoredTarget ? insertionTarget.start : (input.selectionStart ?? input.value.length);
    const end = isStoredTarget ? insertionTarget.end : (input.selectionEnd ?? input.value.length);
    const value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const id = input.closest(".cell").dataset.cellId;
    updateCell(id, value);
    requestAnimationFrame(() => {
      const nextInput = els.cells.querySelector(`[data-cell-id="${id}"] .expression`);
      if (!nextInput) return;
      const position = start + text.length + (Number(relativeCaret) || 0);
      nextInput.focus();
      nextInput.setSelectionRange(position, position);
      rememberInsertionTarget(nextInput);
    });
  }

  function rememberInsertionTarget(input) {
    if (!input?.matches(".expression")) return;
    const cellId = input.closest(".cell")?.dataset.cellId;
    if (!cellId) return;
    focusedCellId = cellId;
    insertionTarget = {
      cellId,
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    };
  }

  function exportNotes() {
    const payload = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = URL.createObjectURL(blob);
    link.download = `math-notes-${date}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    showToast("Esportazione scaricata");
  }

  function importNotes(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported || !Array.isArray(imported.pages) || !imported.pages.length) throw new Error("Formato errato");
        const approved = window.confirm("Importare queste note sostituirà quelle presenti su questo dispositivo. Continuare?");
        if (!approved) return;
        state = normalizeState(imported);
        applyTheme();
        syncSettingsUi();
        persist();
        render();
        showToast("Note importate");
      } catch (_) {
        showToast("Il file non sembra un'esportazione Math Notes.");
      }
    };
    reader.readAsText(file);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    els.toastRegion.querySelector(".toast")?.remove();
    els.toastRegion.append(item);
    toastTimer = window.setTimeout(() => item.remove(), 2800);
  }

  function closeSidebar() { els.sidebar.classList.remove("open"); }

  function closeInsertMenu() {
    const menu = document.getElementById("insertMenu");
    if (menu.hidden) return;
    menu.hidden = true;
    document.getElementById("insertButton").setAttribute("aria-expanded", "false");
  }

  function resetData() {
    const accepted = window.confirm("Ripristinare i dati iniziali? Tutte le note presenti su questo dispositivo verranno eliminate.");
    if (!accepted) return;
    clearTimeout(saveTimer);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* il nuovo stato resterà comunque in memoria */ }
    state = defaultState();
    applyTheme();
    syncSettingsUi();
    persist();
    render();
    els.settingsDialog.close();
    showToast("Dati iniziali ripristinati");
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
      const offerUpdate = () => {
        if (registration.waiting && navigator.serviceWorker.controller) showUpdatePrompt(registration);
      };
      const checkForUpdate = async () => {
        try {
          await registration.update();
          offerUpdate();
        } catch (error) {
          console.warn("Controllo aggiornamenti non riuscito.", error);
        }
      };
      void checkForUpdate();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") offerUpdate();
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (updateRequested) window.location.reload();
      });
      window.addEventListener("focus", () => { void checkForUpdate(); });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void checkForUpdate();
      });
    } catch (error) {
      console.warn("Service worker non registrato.", error);
    }
  }

  function showUpdatePrompt(registration) {
    if (document.getElementById("updatePrompt")) return;
    const prompt = document.createElement("section");
    prompt.id = "updatePrompt";
    prompt.className = "update-prompt";
    prompt.setAttribute("role", "status");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const description = document.createElement("span");
    title.textContent = "Aggiornamento disponibile";
    description.textContent = "È pronta una nuova versione di Math Notes.";
    copy.append(title, description);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = "Aggiorna ora";
    button.addEventListener("click", () => {
      updateRequested = true;
      button.disabled = true;
      button.textContent = "Aggiornamento…";
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
    prompt.append(copy, button);
    els.toastRegion.append(prompt);
  }

  document.getElementById("newPageButton").addEventListener("click", addPage);
  document.getElementById("addLineButton").addEventListener("click", () => addLine());
  document.getElementById("duplicateButton").addEventListener("click", duplicatePage);
  document.getElementById("deletePageButton").addEventListener("click", deletePage);
  document.getElementById("exportButton").addEventListener("click", exportNotes);
  document.getElementById("importButton").addEventListener("click", () => els.importFile.click());
  document.getElementById("settingsButton").addEventListener("click", () => {
    syncSettingsUi();
    els.settingsDialog.showModal();
  });
  document.getElementById("settingsExportButton").addEventListener("click", exportNotes);
  document.getElementById("settingsImportButton").addEventListener("click", () => els.importFile.click());
  document.getElementById("resetDataButton").addEventListener("click", resetData);
  document.getElementById("menuButton").addEventListener("click", () => els.sidebar.classList.add("open"));
  document.getElementById("sidebarClose").addEventListener("click", closeSidebar);
  document.getElementById("insertButton").addEventListener("click", () => {
    const menu = document.getElementById("insertMenu");
    const nextOpen = menu.hidden;
    menu.hidden = !nextOpen;
    document.getElementById("insertButton").setAttribute("aria-expanded", String(nextOpen));
  });

  els.pageList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page-id]");
    if (!button) return;
    state.activePageId = button.dataset.pageId;
    persist();
    render();
    closeSidebar();
  });

  els.pageTitle.addEventListener("input", (event) => {
    const page = activePage();
    page.title = event.target.value || DEFAULT_TITLE;
    page.updatedAt = new Date().toISOString();
    persist();
    renderPages();
    els.pageMeta.textContent = `Modificata oggi · ${page.cells.length} ${page.cells.length === 1 ? "riga" : "righe"}`;
  });

  els.cells.addEventListener("input", (event) => {
    if (!event.target.matches(".expression")) return;
    const cell = event.target.closest(".cell");
    const page = activePage();
    const item = page.cells.find((entry) => entry.id === cell.dataset.cellId);
    if (!item) return;
    item.expression = event.target.value;
    if (page.sliders?.[item.id] && !numericAssignment(item.expression)) {
      delete page.sliders[item.id];
      page.updatedAt = new Date().toISOString();
      persist();
      focusedCellId = item.id;
      render({ preserveFocus: true });
      return;
    }
    page.updatedAt = new Date().toISOString();
    persist();
    focusedCellId = item.id;
    rememberInsertionTarget(event.target);
    const results = calculatePage(page);
    page.cells.forEach((entry) => {
      const output = els.cells.querySelector(`[data-cell-id="${entry.id}"] .result`);
      const current = results.get(entry.id) || {};
      if (!output) return;
      output.className = "result";
      if (current.error) {
        output.classList.add("error");
        output.textContent = current.error;
        output.title = current.error;
      } else if (current.text) {
        output.textContent = `= ${current.text}`;
        output.title = current.text;
      } else {
        output.classList.add("empty");
        output.textContent = "—";
        output.title = "";
      }
    });
  });

  els.cells.addEventListener("focusin", (event) => {
    if (event.target.matches(".expression")) rememberInsertionTarget(event.target);
  });

  els.cells.addEventListener("keyup", (event) => {
    if (event.target.matches(".expression")) rememberInsertionTarget(event.target);
  });

  els.cells.addEventListener("click", (event) => {
    if (event.target.matches(".expression")) rememberInsertionTarget(event.target);
  });

  els.cells.addEventListener("keydown", (event) => {
    if (!event.target.matches(".expression")) return;
    const cellId = event.target.closest(".cell").dataset.cellId;
    if (event.key === "Enter") {
      event.preventDefault();
      addLine(cellId);
    }
    if (event.key === "Backspace" && !event.target.value && activePage().cells.length > 1) {
      event.preventDefault();
      removeLine(cellId);
    }
  });

  els.cells.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-cell]");
    if (button) removeLine(button.dataset.removeCell);
  });

  els.cells.addEventListener("click", (event) => {
    const button = event.target.closest("[data-toggle-slider]");
    if (!button || !button.classList.contains("available")) return;
    const page = activePage();
    const cell = page.cells.find((item) => item.id === button.dataset.toggleSlider);
    const assignment = cell && numericAssignment(cell.expression);
    if (!assignment) return;
    page.sliders ||= {};
    if (page.sliders[cell.id]) delete page.sliders[cell.id];
    else page.sliders[cell.id] = defaultSlider(assignment.value);
    page.updatedAt = new Date().toISOString();
    persist();
    renderCells();
  });

  els.cells.addEventListener("input", (event) => {
    const range = event.target.closest("[data-slider-value]");
    if (!range) return;
    const page = activePage();
    const cell = page.cells.find((item) => item.id === range.dataset.sliderValue);
    const assignment = cell && numericAssignment(cell.expression);
    if (!cell || !assignment) return;
    const nextValue = Number(range.value);
    cell.expression = `${assignment.name} = ${displayNumber(nextValue)}`;
    page.updatedAt = new Date().toISOString();
    range.closest(".slider-panel").querySelector("[data-slider-display]").textContent = displayNumber(nextValue);
    persist();
    refreshResults(page);
  });

  els.cells.addEventListener("change", (event) => {
    const limit = event.target.closest("[data-slider-limit]");
    if (!limit) return;
    const page = activePage();
    const cellId = limit.dataset.cellId;
    const panel = limit.closest(".slider-panel");
    const min = Number(panel.querySelector('[data-slider-limit="min"]').value);
    const max = Number(panel.querySelector('[data-slider-limit="max"]').value);
    const step = Number(panel.querySelector('[data-slider-limit="step"]').value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || min >= max || step <= 0) {
      showToast("Inserisci minimo, massimo e passo validi.");
      renderCells();
      return;
    }
    page.sliders[cellId] = { min, max, step };
    page.updatedAt = new Date().toISOString();
    persist();
    renderCells();
  });

  function clearRowDrag() {
    els.cells.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((row) => {
      row.classList.remove("dragging", "drop-before", "drop-after");
    });
    rowDrag = null;
  }

  els.cells.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-drag-cell]");
    if (!handle || (event.pointerType === "mouse" && event.button !== 0)) return;
    const row = handle.closest(".cell");
    rowDrag = { cellId: handle.dataset.dragCell, pointerId: event.pointerId, before: true };
    handle.setPointerCapture?.(event.pointerId);
    row.classList.add("dragging");
    event.preventDefault();
  });

  document.addEventListener("pointermove", (event) => {
    if (!rowDrag || event.pointerId !== rowDrag.pointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".cell");
    els.cells.querySelectorAll(".drop-before, .drop-after").forEach((row) => row.classList.remove("drop-before", "drop-after"));
    if (!target || target.dataset.cellId === rowDrag.cellId) {
      rowDrag.targetId = null;
      return;
    }
    const bounds = target.getBoundingClientRect();
    rowDrag.targetId = target.dataset.cellId;
    rowDrag.before = event.clientY < bounds.top + bounds.height / 2;
    target.classList.add(rowDrag.before ? "drop-before" : "drop-after");
    event.preventDefault();
  });

  document.addEventListener("pointerup", (event) => {
    if (!rowDrag || event.pointerId !== rowDrag.pointerId) return;
    const drag = rowDrag;
    const page = activePage();
    if (drag.targetId && drag.targetId !== drag.cellId) {
      const fromIndex = page.cells.findIndex((cell) => cell.id === drag.cellId);
      const [moved] = page.cells.splice(fromIndex, 1);
      let targetIndex = page.cells.findIndex((cell) => cell.id === drag.targetId);
      if (!drag.before) targetIndex += 1;
      page.cells.splice(targetIndex, 0, moved);
      page.updatedAt = new Date().toISOString();
      persist();
      focusedCellId = moved.id;
      render({ preserveFocus: true });
    }
    clearRowDrag();
  });

  document.addEventListener("pointercancel", clearRowDrag);

  document.getElementById("insertMenu").addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-insert]")) event.preventDefault();
  });

  document.getElementById("insertMenu").addEventListener("click", (event) => {
    const button = event.target.closest("[data-insert]");
    if (!button) return;
    insertAtCursor(button.dataset.insert, button.dataset.caret);
    closeInsertMenu();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".insert-control")) closeInsertMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeInsertMenu();
  });

  document.addEventListener("selectionchange", () => {
    if (document.activeElement?.matches(".expression")) rememberInsertionTarget(document.activeElement);
  });

  els.importFile.addEventListener("change", (event) => {
    importNotes(event.target.files[0]);
    event.target.value = "";
  });

  function saveSetting(event) {
    if (event.target === els.paletteSetting) state.settings.palette = event.target.value;
    else if (event.target === els.themeSetting) state.settings.theme = event.target.value;
    else if (event.target === els.precisionSetting) state.settings.precision = Number(event.target.value);
    else return;
    state = normalizeState(state);
    applyTheme();
    syncSettingsUi();
    persist();
    focusedCellId = null;
    renderCells();
  }

  [els.paletteSetting, els.themeSetting, els.precisionSetting].forEach((control) => {
    control.addEventListener("input", saveSetting);
    control.addEventListener("change", saveSetting);
  });

  applyTheme();
  syncSettingsUi();
  render();
  void registerServiceWorker();
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  colorScheme?.addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme();
  });
})();
