const KEYS = { plan: "tanda.plan", log: "tanda.log", cycle: "tanda.cycle", chat: "tanda.chat" };
const WEEK = [
  [1, "Lunes"],
  [2, "Martes"],
  [3, "Miércoles"],
  [4, "Jueves"],
  [5, "Viernes"],
  [6, "Sábado"],
  [0, "Domingo"],
];
const SUGGESTIONS = [
  "¿Cómo caliento para esto?",
  "Revisá la técnica del primero",
  "¿Qué hago si está ocupada la máquina?",
  "¿El peso que anoté está bien?",
];

const fileInput = document.getElementById("file");
const importBtn = document.getElementById("import-btn");
const main = document.getElementById("main");
const composer = document.getElementById("composer");
const chips = document.getElementById("chips");
const coachInput = document.getElementById("coach-input");
const coachSend = document.getElementById("coach-send");
const overlay = document.getElementById("overlay");
const sheetTitle = document.getElementById("sheet-title");
const sheetBody = document.getElementById("sheet-body");
const app = document.getElementById("app");
const phone = document.getElementById("phone");

const storedPlan = load(KEYS.plan);
const storedLog = load(KEYS.log);
const storedChat = load(KEYS.chat);

const state = {
  tab: "hoy",
  plan: validPlan(storedPlan) ? storedPlan : null,
  log: storedLog && typeof storedLog === "object" ? storedLog : {},
  cycle: load(KEYS.cycle),
  chat: Array.isArray(storedChat) ? storedChat : [],
  focusKey: null,
  ai: false,
  importing: false,
  coachBusy: false,
};

let importLock = false;
let dismissSheet = null;
let videoToken = 0;
let toastTimer = 0;

function load(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast("No pude guardar en este teléfono.");
  }
}

function validPlan(plan) {
  return Boolean(plan && plan.version === 1 && Array.isArray(plan.days));
}

function todayKey(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function daysBetween(start, end) {
  const a = start.split("-").map(Number);
  const b = end.split("-").map(Number);
  const from = Date.UTC(a[0], a[1] - 1, a[2]);
  const to = Date.UTC(b[0], b[1] - 1, b[2]);
  return Math.round((to - from) / 86400000);
}

function cap(text) {
  const value = String(text || "");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function longDate(date = new Date()) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" }).format(date);
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "onclick" || key === "oninput") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  const list = Array.isArray(children) ? children : children == null ? [] : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function humanError(error, fallback) {
  if (error && error.message === "Failed to fetch") return "No llegué a la compu donde corre Tanda.";
  return (error && error.message) || fallback;
}

function toast(text) {
  const node = document.getElementById("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 3200);
}

function logBag() {
  const key = todayKey();
  if (!state.log[key] || typeof state.log[key] !== "object") state.log[key] = {};
  return state.log[key];
}

function entryFor(id) {
  const entry = logBag()[id];
  if (!entry || typeof entry !== "object") return { sets: [], weight: "" };
  return {
    sets: Array.isArray(entry.sets) ? entry.sets : [],
    weight: typeof entry.weight === "string" ? entry.weight : "",
  };
}

function ensureCycle() {
  if (!state.plan || state.plan.days.some((day) => day.weekday != null)) return;
  if (state.cycle && state.cycle.anchor) return;
  state.cycle = { anchor: todayKey(), offset: 0 };
  save(KEYS.cycle, state.cycle);
}

function automaticDay(plan) {
  if (!plan || !plan.days.length) return { day: null, cycle: false, index: -1 };
  if (plan.days.some((day) => day.weekday != null)) {
    return {
      day: plan.days.find((day) => day.weekday === new Date().getDay()) || null,
      cycle: false,
      index: -1,
    };
  }
  const cycle = state.cycle && state.cycle.anchor ? state.cycle : { anchor: todayKey(), offset: 0 };
  const delta = daysBetween(cycle.anchor, todayKey()) + Number(cycle.offset || 0);
  const index = ((delta % plan.days.length) + plan.days.length) % plan.days.length;
  return { day: plan.days[index], cycle: true, index };
}

function nextTraining(plan) {
  const weekday = new Date().getDay();
  for (let step = 1; step <= 7; step += 1) {
    const day = plan.days.find((item) => item.weekday === (weekday + step) % 7);
    if (day) return { day, inDays: step };
  }
  return null;
}

function meta(ex) {
  const parts = [];
  if (ex.sets) {
    const label = ex.setsLabel && ex.setsLabel !== String(ex.sets) ? ex.setsLabel : String(ex.sets);
    parts.push(label + (Number(ex.sets) === 1 ? " serie" : " series"));
  }
  if (ex.reps) {
    const timed = /^\d+\s*(s|seg|min)\b/i.test(ex.reps);
    const words = /[A-Za-zÁÉÍÓÚáéíóú]/.test(ex.reps) && !/^\d/.test(ex.reps);
    parts.push(timed || words || /rep/i.test(ex.reps) ? ex.reps : ex.reps + " reps");
  }
  if (ex.weight) parts.push(ex.weight);
  if (ex.rest) parts.push("descanso " + ex.rest);
  return parts.join(" · ");
}

function seriesOf(day) {
  let total = 0;
  let done = 0;
  for (const block of day.blocks) {
    for (const ex of block.exercises) {
      const count = ex.sets || 1;
      total += count;
      done += Math.min(count, entryFor(ex.id).sets.filter(Boolean).length);
    }
  }
  return { total, done };
}

function tallyText(progress) {
  const noun = progress.total === 1 ? " serie" : " series";
  if (progress.total > 0 && progress.done === progress.total) return "Listo · " + progress.total + noun;
  return progress.done + " de " + progress.total + noun;
}

function exerciseCount(day) {
  return day.blocks.reduce((sum, block) => sum + block.exercises.length, 0);
}

function agenda(plan) {
  if (!plan.days.some((day) => day.weekday != null)) {
    return plan.days.map((day) => ({ day, rest: false, label: day.label, weekday: null }));
  }
  const rows = WEEK.map(([weekday, label]) => {
    const day = plan.days.find((item) => item.weekday === weekday);
    return day ? { day, rest: false, label: day.label, weekday } : { day: null, rest: true, label, weekday };
  });
  const shown = new Set(rows.filter((row) => row.day).map((row) => row.day.key));
  for (const day of plan.days) {
    if (!shown.has(day.key)) rows.push({ day, rest: false, label: day.label, weekday: day.weekday });
  }
  return rows;
}

function routineContext() {
  if (!state.plan) return "Todavía no hay una rutina cargada.";
  const auto = automaticDay(state.plan);
  const picked = state.focusKey ? state.plan.days.find((day) => day.key === state.focusKey) : null;
  const day = picked || auto.day;
  if (!day) {
    const next = nextTraining(state.plan);
    return next ? "Hoy no hay rutina. La próxima es " + next.day.label + "." : "Hoy no hay rutina cargada.";
  }
  const lines = ["Día: " + day.label];
  let number = 1;
  for (const block of day.blocks) {
    if (block.title) lines.push(block.title);
    for (const ex of block.exercises) {
      const entry = entryFor(ex.id);
      const done = entry.sets.filter(Boolean).length;
      const total = ex.sets || 1;
      let line = number + ". " + ex.name + " — " + (meta(ex) || "sin detalle") + ". Marcadas hoy: " + done + "/" + total;
      if (entry.weight) line += ". Peso anotado: " + entry.weight;
      lines.push(line);
      number += 1;
    }
  }
  return lines.join("\n").slice(0, 5000);
}

function closeSheet() {
  overlay.hidden = true;
  app.inert = false;
  sheetBody.replaceChildren();
  const finish = dismissSheet;
  dismissSheet = null;
  if (finish) finish();
}

function openSheet(title, nodes, onDismiss) {
  videoToken += 1;
  dismissSheet = onDismiss || null;
  sheetTitle.textContent = title;
  sheetBody.replaceChildren(...nodes);
  overlay.hidden = false;
  app.inert = true;
}

function ask(title, copy, okLabel) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dismissSheet = null;
      closeSheet();
      resolve(value);
    };
    openSheet(
      title,
      [
        el("p", { class: "sheet-copy" }, copy),
        el("div", { class: "sheet-actions" }, [
          el("button", { class: "btn ghost", type: "button", onclick: () => finish(false) }, "Cancelar"),
          el("button", { class: "btn primary", type: "button", onclick: () => finish(true) }, okLabel),
        ]),
      ],
      () => finish(false)
    );
  });
}

function videoCard(video) {
  return el("li", {}, el("a", {
    class: "video",
    href: "https://www.youtube.com/watch?v=" + video.id,
    target: "_blank",
    rel: "noopener noreferrer",
  }, [
    el("img", {
      src: "https://i.ytimg.com/vi/" + video.id + "/hqdefault.jpg",
      alt: "",
      referrerpolicy: "no-referrer",
    }),
    el("span", {}, [
      el("strong", {}, video.title),
      el("small", {}, [video.author, video.length].filter(Boolean).join(" · ")),
    ]),
  ]));
}

async function openVideos(ex) {
  openSheet(ex.name, [el("p", { class: "sheet-copy" }, "Buscando videos de la técnica…")]);
  const token = videoToken;
  try {
    const response = await fetch("/api/videos?q=" + encodeURIComponent(ex.name));
    const data = await response.json().catch(() => ({}));
    if (token !== videoToken || overlay.hidden) return;
    if (!response.ok) throw new Error(data.message || "No pude buscar videos.");
    const videos = (data.videos || []).filter((video) => video && /^[\w-]{11}$/.test(video.id) && video.title);
    if (!videos.length) {
      sheetBody.replaceChildren(el("p", { class: "sheet-copy" }, "No encontré videos para este nombre."));
      return;
    }
    sheetBody.replaceChildren(el("ul", { class: "videos" }, videos.map(videoCard)));
  } catch (error) {
    if (token !== videoToken || overlay.hidden) return;
    sheetBody.replaceChildren(el("p", { class: "sheet-copy" }, error.message || "Sin conexión con la compu."));
  }
}

function toggleSet(ex, index) {
  const current = entryFor(ex.id);
  const total = ex.sets || 1;
  const sets = Array.from({ length: total }, (_, i) => Boolean(current.sets[i]));
  sets[index] = !sets[index];
  logBag()[ex.id] = { sets, weight: current.weight };
  save(KEYS.log, state.log);
  render();
}

function setWeight(ex, value) {
  const current = entryFor(ex.id);
  const total = ex.sets || 1;
  const sets = Array.from({ length: total }, (_, i) => Boolean(current.sets[i]));
  logBag()[ex.id] = { sets, weight: value.slice(0, 24) };
  save(KEYS.log, state.log);
}

function exerciseCard(ex, number) {
  const entry = entryFor(ex.id);
  const total = ex.sets || 1;
  const done = Array.from({ length: total }, (_, i) => Boolean(entry.sets[i])).every(Boolean);
  const buttons = [];
  for (let i = 0; i < total; i += 1) {
    const on = Boolean(entry.sets[i]);
    buttons.push(el("button", {
      type: "button",
      class: "set" + (on ? " on" : "") + (ex.sets ? "" : " wide"),
      "aria-pressed": on ? "true" : "false",
      "aria-label": ex.sets ? "Serie " + (i + 1) + (on ? " hecha" : " pendiente") : (on ? "Ejercicio hecho" : "Marcar hecho"),
      onclick: () => toggleSet(ex, i),
    }, ex.sets ? String(i + 1) : "Hecho"));
  }
  return el("article", { class: "card" + (done ? " done" : "") }, [
    el("div", { class: "card-top" }, [
      el("span", { class: "idx" }, String(number).padStart(2, "0")),
      el("h3", { class: "name" }, ex.name),
      el("button", { type: "button", class: "tech", onclick: () => openVideos(ex) }, "Técnica"),
    ]),
    meta(ex) ? el("p", { class: "meta" }, meta(ex)) : null,
    ex.notes ? el("p", { class: "note-line" }, ex.notes) : null,
    el("div", { class: "card-foot" }, [
      el("div", { class: "sets" }, buttons),
      el("input", {
        class: "weight",
        type: "text",
        inputmode: "decimal",
        maxlength: "24",
        placeholder: ex.weight || "kg",
        value: entry.weight,
        autocomplete: "off",
        autocorrect: "off",
        spellcheck: "false",
        "aria-label": "Peso de hoy para " + ex.name,
        oninput: (event) => setWeight(ex, event.target.value),
      }),
    ]),
  ]);
}

function progressBar(progress) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const bar = el("div", {
    class: "progress",
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": String(progress.total),
    "aria-valuenow": String(progress.done),
    "aria-label": "Series de hoy",
  });
  const fill = document.createElement("span");
  fill.style.width = pct + "%";
  bar.append(fill);
  return bar;
}

function emptyState() {
  return [
    el("p", { class: "kicker" }, cap(longDate())),
    el("h1", {}, "Hoy"),
    el("p", { class: "lead" }, "Subí el Excel o el PDF de tu rutina. Tanda arma el día, te deja marcar las series y busca un video de cada ejercicio."),
    el("button", {
      class: "btn primary",
      type: "button",
      disabled: state.importing ? "" : null,
      onclick: () => fileInput.click(),
    }, state.importing ? "Leyendo…" : "Elegir archivo"),
    el("button", {
      class: "btn ghost",
      type: "button",
      disabled: state.importing ? "" : null,
      onclick: () => loadExample(),
    }, "Probar con el ejemplo"),
    el("a", { class: "text-btn", href: "/sample/rutina-ejemplo.xlsx", download: "rutina-ejemplo.xlsx" }, "Descargar el Excel de ejemplo"),
    el("p", { class: "fine" }, "La rutina queda en este teléfono. Los videos y el coach necesitan la compu donde está corriendo Tanda."),
  ];
}

function clearVisibleMarks(day) {
  const bag = logBag();
  for (const block of day.blocks) {
    for (const ex of block.exercises) delete bag[ex.id];
  }
  save(KEYS.log, state.log);
  render();
}

function shiftCycle(by) {
  const current = state.cycle && state.cycle.anchor ? state.cycle : { anchor: todayKey(), offset: 0 };
  current.offset = Number(current.offset || 0) + by;
  state.cycle = current;
  save(KEYS.cycle, current);
  state.focusKey = null;
  render();
}

function viewHoy() {
  if (!state.plan) return emptyState();
  const auto = automaticDay(state.plan);
  const picked = state.focusKey ? state.plan.days.find((day) => day.key === state.focusKey) : null;
  const day = picked || auto.day;
  const nodes = [el("p", { class: "kicker" }, cap(longDate()))];
  if (!day) {
    nodes.push(el("h1", {}, "Descanso"));
    const next = nextTraining(state.plan);
    if (!next) {
      nodes.push(el("p", { class: "lead" }, "Este día de la semana no tiene ejercicios."));
      return nodes;
    }
    const when = next.inDays === 1 ? "Mañana" : "En " + next.inDays + " días";
    nodes.push(el("p", { class: "lead" }, when + " toca " + next.day.label + "."));
    nodes.push(el("button", {
      class: "btn primary",
      type: "button",
      onclick: () => {
        state.focusKey = next.day.key;
        render({ resetScroll: true });
      },
    }, "Ver " + next.day.label));
    return nodes;
  }

  const different = !auto.day || day.key !== auto.day.key;
  if (different) {
    nodes.push(el("div", { class: "banner" }, [
      el("p", {}, "Estás viendo " + day.label + ". Las series se anotan en el día de hoy."),
      el("button", { type: "button", onclick: () => { state.focusKey = null; render({ resetScroll: true }); } }, "Volver a hoy"),
    ]));
  }
  nodes.push(el("h1", {}, day.label));
  const progress = seriesOf(day);
  nodes.push(el("p", { class: "tally" }, tallyText(progress)));
  nodes.push(progressBar(progress));
  if (auto.cycle && !different) {
    nodes.push(el("div", { class: "cycle" }, [
      el("span", {}, "Día " + (auto.index + 1) + " de " + state.plan.days.length),
      el("button", { class: "text-btn", type: "button", onclick: () => shiftCycle(-1) }, "Anterior"),
      el("button", { class: "text-btn", type: "button", onclick: () => shiftCycle(1) }, "Saltear"),
    ]));
  }
  let number = 0;
  for (const block of day.blocks) {
    if (block.title) nodes.push(el("h2", { class: "block-title" }, block.title));
    for (const ex of block.exercises) {
      number += 1;
      nodes.push(exerciseCard(ex, number));
    }
  }
  if (progress.done > 0) {
    nodes.push(el("button", { class: "text-btn", type: "button", onclick: () => clearVisibleMarks(day) }, "Borrar marcas de hoy"));
  }
  return nodes;
}

function dayRow(row, auto) {
  const isToday = (row.day && auto.day && row.day.key === auto.day.key) || (row.rest && row.weekday === new Date().getDay());
  if (row.rest) {
    return el("div", { class: "day rest" }, [
      el("strong", {}, row.label),
      el("em", {}, isToday ? "Hoy" : "Descanso"),
    ]);
  }
  const count = exerciseCount(row.day);
  const titles = row.day.blocks.map((block) => block.title).filter(Boolean);
  const preview = titles.length
    ? titles.slice(0, 3).join(" · ")
    : row.day.blocks[0].exercises.slice(0, 2).map((ex) => ex.name).join(" · ");
  return el("button", {
    class: "day",
    type: "button",
    onclick: () => {
      state.focusKey = row.day.key;
      state.tab = "hoy";
      render({ resetScroll: true });
    },
  }, [
    el("strong", {}, row.label),
    el("em", {}, isToday ? "Hoy" : count + (count === 1 ? " ejercicio" : " ejercicios")),
    el("span", {}, preview),
  ]);
}

async function deletePlan() {
  const ok = await ask("Borrar rutina", "Se borra de este teléfono. El archivo original no se toca.", "Borrar");
  if (!ok) return;
  state.plan = null;
  state.focusKey = null;
  localStorage.removeItem(KEYS.plan);
  state.tab = "hoy";
  render({ resetScroll: true });
}

function viewSemana() {
  if (!state.plan) return emptyState();
  const auto = automaticDay(state.plan);
  const when = shortDate(state.plan.importedAt);
  const nodes = [
    el("p", { class: "kicker" }, "Plan"),
    el("h1", {}, "Semana"),
    el("p", { class: "fine" }, "Revisá que los días coincidan con tu archivo."),
  ];
  for (const row of agenda(state.plan)) nodes.push(dayRow(row, auto));
  if (state.plan.warnings && state.plan.warnings.length) {
    nodes.push(el("p", { class: "fine" }, state.plan.warnings.join(" ")));
  }
  nodes.push(el("footer", { class: "plan-foot" }, [
    el("p", { class: "fine" }, [state.plan.sourceName, when].filter(Boolean).join(" · ")),
    el("button", { class: "text-btn", type: "button", onclick: () => fileInput.click() }, "Subir otro archivo"),
    el("button", { class: "text-btn danger", type: "button", onclick: () => deletePlan() }, "Borrar rutina"),
  ]));
  return nodes;
}

function formatCoach(text) {
  const frag = document.createDocumentFragment();
  for (const block of String(text || "").split(/\n{2,}/)) {
    if (!block.trim()) continue;
    const p = document.createElement("p");
    block.split("\n").forEach((line, index) => {
      if (index) p.append(document.createElement("br"));
      const pattern = /\*\*(.+?)\*\*/g;
      let last = 0;
      let match;
      while ((match = pattern.exec(line))) {
        p.append(line.slice(last, match.index));
        const strong = document.createElement("strong");
        strong.textContent = match[1];
        p.append(strong);
        last = match.index + match[0].length;
      }
      p.append(line.slice(last));
    });
    frag.append(p);
  }
  if (!frag.childNodes.length) frag.append(document.createElement("p"));
  return frag;
}

function viewCoach() {
  const nodes = [
    el("p", { class: "kicker" }, state.ai ? "Grok" : "Sin conectar"),
    el("h1", {}, "Coach"),
  ];
  if (!state.ai) {
    nodes.push(el("section", { class: "setup" }, [
      el("h2", {}, "El coach corre en la compu"),
      el("p", {}, "La rutina y las series funcionan igual. Para preguntar, creá una clave en console.x.ai, copiá .env.example a .env dentro de la carpeta gym y pegá XAI_API_KEY. Reiniciá Tanda."),
      el("a", { class: "text-btn", href: "https://console.x.ai", target: "_blank", rel: "noopener noreferrer" }, "Abrir console.x.ai"),
    ]));
  }
  if (!state.chat.length && !state.coachBusy) {
    nodes.push(el("p", { class: "lead" }, state.plan ? "Sabe qué te toca hoy y qué series marcaste." : "Cuando subas una rutina, la tiene en cuenta."));
  }
  for (const message of state.chat) {
    const kind = message.role === "user" ? "user" : message.role === "note" ? "note" : "coach";
    nodes.push(el("div", { class: "msg " + kind }, formatCoach(message.content)));
  }
  if (state.coachBusy) {
    nodes.push(el("div", { class: "msg coach", id: "coach-stream" }, el("p", { class: "fine" }, "Pensando…")));
  }
  if (state.chat.length && !state.coachBusy) {
    nodes.push(el("button", {
      class: "text-btn",
      type: "button",
      onclick: () => {
        state.chat = [];
        save(KEYS.chat, state.chat);
        render();
      },
    }, "Borrar conversación"));
  }
  return nodes;
}

function view() {
  if (state.tab === "semana") return viewSemana();
  if (state.tab === "coach") return viewCoach();
  return viewHoy();
}

function render(options) {
  const keep = options && options.resetScroll ? 0 : main.scrollTop;
  main.replaceChildren(...view());
  main.scrollTop = options && options.stick ? main.scrollHeight : keep;
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.setAttribute("aria-selected", button.dataset.tab === state.tab ? "true" : "false");
  }
  composer.hidden = state.tab !== "coach";
  coachSend.disabled = Boolean(state.coachBusy);
  importBtn.setAttribute("aria-busy", state.importing ? "true" : "false");
  chips.replaceChildren();
  const showChips = state.tab === "coach" && !state.coachBusy && !state.chat.some((message) => message.role === "user");
  if (showChips) {
    for (const text of SUGGESTIONS) {
      chips.append(el("button", { type: "button", class: "chip", onclick: () => sendCoach(text) }, text));
    }
  }
}

function applyPlan(plan) {
  state.plan = plan;
  state.focusKey = null;
  save(KEYS.plan, plan);
  if (!plan.days.some((day) => day.weekday != null)) {
    state.cycle = { anchor: todayKey(), offset: 0 };
    save(KEYS.cycle, state.cycle);
  }
  state.tab = "hoy";
  const extra = plan.warnings && plan.warnings.length ? " Revisá la semana." : "";
  toast(plan.stats.days + " días · " + plan.stats.exercises + " ejercicios." + extra);
}

async function upload(buffer, name) {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "X-Filename": encodeURIComponent(name) },
    body: buffer,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "No pude importar ese archivo.");
  return data;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No pude leer el archivo en el teléfono."));
    reader.readAsArrayBuffer(file);
  });
}

async function importFile(file) {
  if (!file || importLock) return;
  if (!/\.(xlsx|xls|csv|txt|pdf)$/i.test(file.name)) {
    toast("Tiene que ser un Excel, un CSV o un PDF.");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast("El archivo pasa de 8 MB.");
    return;
  }
  importLock = true;
  let applied = false;
  try {
    if (state.plan) {
      const ok = await ask(
        "Reemplazar rutina",
        "La rutina guardada en este teléfono se cambia por este archivo. Si un ejercicio se llama igual, las marcas de hoy se mantienen.",
        "Reemplazar"
      );
      if (!ok) return;
    }
    state.importing = true;
    toast(file.name.toLowerCase().endsWith(".pdf") ? "Leyendo el PDF…" : "Leyendo el archivo…");
    render();
    applyPlan(await upload(await readFile(file), file.name));
    applied = true;
  } catch (error) {
    toast(humanError(error, "No pude importar."));
  } finally {
    importLock = false;
    state.importing = false;
    fileInput.value = "";
    render(applied ? { resetScroll: true } : undefined);
  }
}

async function loadExample() {
  if (importLock) return;
  importLock = true;
  let applied = false;
  try {
    if (state.plan) {
      const ok = await ask(
        "Usar el ejemplo",
        "Reemplaza la rutina guardada en este teléfono por una de pecho, espalda, pierna y hombros.",
        "Cargar ejemplo"
      );
      if (!ok) return;
    }
    state.importing = true;
    toast("Leyendo el Excel…");
    render();
    const response = await fetch("/sample/rutina-ejemplo.xlsx");
    if (!response.ok) throw new Error("No encontré el Excel de ejemplo.");
    applyPlan(await upload(await response.arrayBuffer(), "rutina-ejemplo.xlsx"));
    applied = true;
  } catch (error) {
    toast(humanError(error, "No pude cargar el ejemplo."));
  } finally {
    importLock = false;
    state.importing = false;
    render(applied ? { resetScroll: true } : undefined);
  }
}

async function sendCoach(text) {
  const content = String(text || "").trim();
  if (!content || state.coachBusy) return;
  state.chat.push({ role: "user", content: content.slice(0, 2000) });
  state.chat = state.chat.slice(-30);
  state.coachBusy = true;
  save(KEYS.chat, state.chat);
  render({ stick: true });
  let acc = "";
  let failed = "";
  try {
    const response = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.chat.filter((message) => message.role === "user" || message.role === "assistant").slice(-12),
        context: routineContext(),
      }),
    });
    if (!response.ok || !response.body) {
      const data = response.ok ? {} : await response.json().catch(() => ({}));
      throw new Error(data.message || "El coach no respondió.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        let payload;
        try {
          payload = JSON.parse(trimmed.slice(5).trim());
        } catch {
          continue;
        }
        if (!payload || payload.error) throw new Error((payload && payload.error) || "Se cortó la respuesta.");
        if (!payload.t) continue;
        acc += payload.t;
        const box = document.getElementById("coach-stream");
        if (box) {
          box.replaceChildren(formatCoach(acc));
          const distance = main.scrollHeight - main.scrollTop - main.clientHeight;
          if (distance < 140) main.scrollTop = main.scrollHeight;
        }
      }
    }
    if (!acc) throw new Error("El coach no mandó texto.");
  } catch (error) {
    failed = humanError(error, "Se cortó la respuesta.");
  } finally {
    if (acc) state.chat.push({ role: "assistant", content: acc });
    if (failed) state.chat.push({ role: "note", content: failed });
    state.chat = state.chat.slice(-30);
    state.coachBusy = false;
    save(KEYS.chat, state.chat);
    render({ stick: true });
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) importFile(file);
});
importBtn.addEventListener("click", () => fileInput.click());

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => {
    state.tab = button.dataset.tab;
    render({ resetScroll: true });
  });
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = coachInput.value;
  coachInput.value = "";
  coachInput.style.height = "auto";
  sendCoach(text);
});

coachInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const text = coachInput.value;
    coachInput.value = "";
    coachInput.style.height = "auto";
    sendCoach(text);
  }
});

coachInput.addEventListener("input", () => {
  coachInput.style.height = "auto";
  coachInput.style.height = Math.min(coachInput.scrollHeight, 120) + "px";
});

document.getElementById("sheet-close").addEventListener("click", closeSheet);
document.getElementById("backdrop").addEventListener("click", closeSheet);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !overlay.hidden) closeSheet();
});

let dragDepth = 0;
phone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  phone.classList.add("dropping");
});
phone.addEventListener("dragover", (event) => event.preventDefault());
phone.addEventListener("dragleave", () => {
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    phone.classList.remove("dropping");
  }
});
phone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  phone.classList.remove("dropping");
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) importFile(file);
});

ensureCycle();
render();

fetch("/api/health")
  .then((response) => response.json())
  .then((data) => {
    state.ai = Boolean(data && data.ai);
    if (state.tab === "coach") render();
  })
  .catch(() => {});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
