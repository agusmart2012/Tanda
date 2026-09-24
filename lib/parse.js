"use strict";

const XLSX = require("xlsx");
const { extractPdfPages } = require("./pdf");
const { askDaySplit } = require("./ai-split");

const DAY_WORDS = [
  { token: "lunes", weekday: 1, label: "Lunes", lead: /^(lunes|monday|lun)\b/i },
  { token: "martes", weekday: 2, label: "Martes", lead: /^(martes|tuesday|mar)\b/i },
  { token: "miercoles", weekday: 3, label: "Miércoles", lead: /^(mi[eé]rcoles|wednesday|mi[eé])\b/i },
  { token: "jueves", weekday: 4, label: "Jueves", lead: /^(jueves|thursday|jue)\b/i },
  { token: "viernes", weekday: 5, label: "Viernes", lead: /^(viernes|friday|vie)\b/i },
  { token: "sabado", weekday: 6, label: "Sábado", lead: /^(s[aá]bado|saturday|s[aá]b)\b/i },
  { token: "domingo", weekday: 0, label: "Domingo", lead: /^(domingo|sunday|dom)\b/i },
];

const FIELDS = {
  name: ["ejercicio", "exercise", "movimiento", "nombre", "actividad", "ej"],
  sets: ["series", "serie", "sets", "set", "n series", "num series", "nro series"],
  reps: ["reps", "rep", "repeticiones", "repeticion", "repes", "repeticiones por serie"],
  weight: ["peso", "kg", "carga", "weight", "kilos", "peso kg"],
  rest: ["descanso", "rest", "pausa", "recuperacion"],
  notes: ["notas", "nota", "notes", "observaciones", "observacion", "comentario", "obs"],
  day: ["dia", "day", "jornada", "dia de la semana", "sesion", "entrenamiento", "workout"],
  block: ["grupo", "musculo", "bloque", "seccion", "musculos", "muscle", "grupo muscular"],
  date: ["fecha", "date"],
};

const FIELD_WORDS = Object.entries(FIELDS)
  .flatMap(([field, words]) => words.map((word) => ({ field, word })))
  .sort((a, b) => b.word.length - a.word.length);

function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pretty(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const letters = clean.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  const shouted = letters.length > 3 && letters === letters.toUpperCase();
  if (!shouted) return clean;
  const lower = clean.toLowerCase();
  return lower.replace(/(^|\s)(\p{L})/gu, (_, gap, char) => gap + char.toUpperCase());
}

function asTitle(text) {
  const value = pretty(text);
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function slug(value) {
  return norm(value).replace(/\s+/g, "-").slice(0, 80) || "x";
}

function splitDayHeading(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  for (const day of DAY_WORDS) {
    const match = raw.match(day.lead);
    if (!match) continue;
    const rest = asTitle(raw.slice(match[0].length).replace(/^[\s\-–:|/]+/, ""));
    return { weekday: day.weekday, label: day.label, rest };
  }
  return null;
}

function fieldOf(value) {
  const n = norm(value);
  if (!n || n.length > 42) return null;
  for (const { field, word } of FIELD_WORDS) {
    if (n === word) return field;
    const prefixOk = word.length >= 4 || field === "day";
    if (prefixOk && n.startsWith(word + " ")) return field;
  }
  return null;
}

function findHeader(rows) {
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i += 1) {
    const fields = new Set();
    for (const value of rows[i]) {
      const field = fieldOf(value);
      if (field) fields.add(field);
    }
    if (!fields.has("name") || fields.size < 2) continue;
    let score = fields.size + 2;
    if (fields.has("sets") || fields.has("reps")) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function mapColumns(header) {
  const map = {};
  header.forEach((value, index) => {
    const field = fieldOf(value);
    if (field && map[field] == null) map[field] = index;
  });
  if (map.name == null) {
    const used = new Set(Object.values(map));
    const index = header.findIndex((_, i) => !used.has(i));
    if (index >= 0) map.name = index;
  }
  return map;
}

function cell(row, index) {
  if (index == null || index < 0) return "";
  return String(row[index] ?? "").replace(/\s+/g, " ").trim();
}

function clampSets(value) {
  const nums = [...String(value ?? "").matchAll(/\d{1,2}/g)]
    .map((match) => Number(match[0]))
    .filter((n) => n >= 1 && n <= 12);
  if (!nums.length) return null;
  return nums[nums.length - 1];
}

function formatWeight(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const match = s.match(/^(\d+(?:[.,]\d+)?)\s*(kg|kilos?|lb|lbs)?$/i);
  if (!match) return s.replace(/\s+/g, " ");
  const n = match[1].replace(",", ".");
  const unit = match[2] && match[2].toLowerCase().startsWith("lb") ? "lb" : "kg";
  return n + " " + unit;
}

function formatRest(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const unit = s.match(/(\d+(?:[.,]\d+)?)\s*(min(?:utos)?|m|s|seg(?:undos)?|')\b/i);
  if (unit) {
    const n = unit[1].replace(",", ".");
    return unit[2].toLowerCase().startsWith("m") || unit[2] === "'" ? n + " min" : n + " s";
  }
  if (/^\d+(?:[.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(",", "."));
    // 2 o 3 en una columna Descanso suelen ser minutos. 15 en adelante, segundos.
    return n <= 5 ? n + " min" : n + " s";
  }
  return s;
}

function parseFreeText(line) {
  let work = String(line ?? "").replace(/\s+/g, " ").trim();
  if (!work) return null;

  let rest = "";
  const restMatch = work.match(
    /(?:descanso|rest|pausa|recuperacion|recuperación)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(min(?:utos)?|m|s|seg(?:undos)?|')?/i
  );
  if (restMatch) {
    rest = formatRest(restMatch[1] + (restMatch[2] ? " " + restMatch[2] : ""));
    work = (work.slice(0, restMatch.index) + " " + work.slice(restMatch.index + restMatch[0].length)).replace(/\s+/g, " ").trim();
  }

  let sets = null;
  let setsLabel = "";
  let reps = "";
  const pair = work.match(/(\d{1,2})\s*[x×]\s*(\d{1,2}(?:\s*[-–a]\s*\d{1,2})?)/i);
  const series = work.match(/(\d{1,2})\s*series?(?:\s+de\s+(\d{1,2}(?:\s*[-–a]\s*\d{1,2})?|al\s+fallo))?/i);
  if (pair) {
    sets = clampSets(pair[1]);
    setsLabel = pair[1];
    reps = pair[2].replace(/\s+/g, "").replace(/a/gi, "-");
    work = (work.slice(0, pair.index) + " " + work.slice(pair.index + pair[0].length)).replace(/\s+/g, " ").trim();
  } else if (series) {
    sets = clampSets(series[1]);
    setsLabel = series[1];
    reps = series[2] ? series[2].replace(/\s+/g, " ").trim() : "";
    work = (work.slice(0, series.index) + " " + work.slice(series.index + series[0].length)).replace(/\s+/g, " ").trim();
  }

  let weight = "";
  const weightMatch = work.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|lb|lbs)\b/i);
  if (weightMatch) {
    weight = formatWeight(weightMatch[1] + " " + weightMatch[2]);
    work = (work.slice(0, weightMatch.index) + " " + work.slice(weightMatch.index + weightMatch[0].length)).replace(/\s+/g, " ").trim();
  } else if (sets != null) {
    const trailing = work.match(/(?:^|\s)(\d+(?:[.,]\d+)?)$/);
    if (trailing) {
      weight = formatWeight(trailing[1]);
      work = work.slice(0, trailing.index).trim();
    }
  }

  const timed = !sets && !reps ? work.match(/^(.+?)\s+(\d+)\s*(s|seg|min)\b/i) : null;
  if (timed) {
    return {
      type: "exercise",
      name: pretty(timed[1]),
      sets: null,
      setsLabel: "",
      reps: timed[2] + " " + timed[3].toLowerCase(),
      weight: "",
      rest,
    };
  }

  if (sets == null && !reps && !weight) {
    const columns = work.match(/^(.+?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])\s+(\d{1,2})\s+(\d{1,2}(?:\s*[-–]\s*\d{1,2})?)(?:\s+(\d+(?:[.,]\d+)?))?$/);
    const repsNumber = columns ? Number(columns[3]) : 0;
    if (columns && Number(columns[2]) <= 12 && repsNumber >= 1 && repsNumber <= 50) {
      return {
        type: "exercise",
        name: pretty(columns[1]),
        sets: clampSets(columns[2]),
        setsLabel: columns[2],
        reps: columns[3].replace(/\s+/g, ""),
        weight: columns[4] ? formatWeight(columns[4]) : "",
        rest,
      };
    }
  }

  const name = pretty(work.replace(/[-–|:@/]+/g, " "));
  if (!name) return null;
  if (sets == null && !reps && !weight && !rest) return { type: "heading", title: name };
  return { type: "exercise", name, sets, setsLabel, reps, weight, rest };
}

function makeDay(label, weekday) {
  return { label: label || "Rutina", weekday: weekday == null ? null : weekday, blocks: [] };
}

function exerciseFields(partial) {
  return {
    name: partial.name,
    sets: partial.sets == null ? null : partial.sets,
    setsLabel: partial.setsLabel || "",
    reps: partial.reps || "",
    weight: partial.weight || "",
    rest: partial.rest || "",
    notes: partial.notes || "",
  };
}

function mergeReps(a, b) {
  if (!a) return b || "";
  if (!b || norm(a) === norm(b)) return a;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    const lo = Math.min(na, nb);
    const hi = Math.max(na, nb);
    return lo === hi ? String(lo) : lo + "-" + hi;
  }
  return a;
}

function collapseSets(list) {
  const allSingle = list.every((item) => item.sets == null || item.sets <= 1);
  const hasRun = list.some((item, index) => index > 0 && norm(item.name) === norm(list[index - 1].name));
  if (!allSingle || !hasRun) return list;
  const out = [];
  for (const item of list) {
    const prev = out[out.length - 1];
    if (prev && norm(prev.name) === norm(item.name)) {
      prev.sets = (prev.sets || 1) + 1;
      prev.setsLabel = String(prev.sets);
      prev.reps = mergeReps(prev.reps, item.reps);
      if (!prev.weight && item.weight) prev.weight = item.weight;
      if (!prev.rest && item.rest) prev.rest = item.rest;
      if (item.notes && prev.notes !== item.notes) {
        prev.notes = prev.notes ? prev.notes + " · " + item.notes : item.notes;
      }
      continue;
    }
    out.push({ ...item, sets: item.sets || 1, setsLabel: item.setsLabel || String(item.sets || 1) });
  }
  return out;
}

function parseTable(title, dataRows, map) {
  const expanded = expandDates(dataRows, map);
  const rows = expanded.rows;
  const columns = expanded.map;
  const days = [];
  let day = null;
  let block = null;

  function switchDay(label, weekday) {
    const existing = days.find((item) => norm(item.label) === norm(label));
    if (existing) {
      day = existing;
      if (day.weekday == null && weekday != null) day.weekday = weekday;
    } else {
      day = makeDay(label, weekday);
      days.push(day);
    }
    block = null;
  }

  function useBlock(titleText) {
    const label = titleText || "";
    if (block && norm(block.title) === norm(label)) return block;
    block = { title: label, exercises: [] };
    day.blocks.push(block);
    return block;
  }

  switchDay(title.label || "Rutina", title.weekday);
  if (title.rest) useBlock(asTitle(title.rest));

  for (const row of rows) {
    const rawName = cell(row, columns.name);
    const dayCell = cell(row, columns.day);
    const blockCell = cell(row, columns.block);
    const setsRaw = cell(row, columns.sets);
    const repsRaw = cell(row, columns.reps);
    const weightRaw = cell(row, columns.weight);
    const restRaw = cell(row, columns.rest);
    const notes = cell(row, columns.notes);

    if (dayCell) {
      const heading = splitDayHeading(dayCell);
      const label = heading ? heading.label : asTitle(dayCell);
      const weekday = heading ? heading.weekday : null;
      if (norm(label) !== norm(day.label)) switchDay(label, weekday);
      else if (day.weekday == null && weekday != null) day.weekday = weekday;
      if (heading && heading.rest) useBlock(asTitle(heading.rest));
    }

    const fieldsEmpty = !setsRaw && !repsRaw && !weightRaw && !restRaw && !notes;
    if (rawName && fieldsEmpty && !blockCell) {
      const asDay = rawName.length < 42 ? splitDayHeading(rawName) : null;
      if (asDay) {
        switchDay(asDay.label, asDay.weekday);
        if (asDay.rest) useBlock(asDay.rest);
        continue;
      }
      const free = parseFreeText(rawName);
      if (free && free.type === "exercise") {
        if (!block) useBlock("");
        block.exercises.push(exerciseFields(free));
        continue;
      }
      useBlock(asTitle(rawName));
      continue;
    }

    if (blockCell && (!block || norm(block.title) !== norm(pretty(blockCell)))) {
      useBlock(asTitle(blockCell));
    }
    if (!rawName) continue;

    let name = rawName;
    let sets = clampSets(setsRaw);
    let setsLabel = setsRaw;
    let reps = repsRaw;
    let weight = formatWeight(weightRaw);
    let rest = formatRest(restRaw);

    if (!setsRaw && !repsRaw && !weightRaw) {
      const free = parseFreeText(rawName);
      if (free && free.type === "exercise") {
        name = free.name;
        sets = free.sets;
        setsLabel = free.setsLabel;
        reps = free.reps;
        weight = free.weight || weight;
        rest = free.rest || rest;
      }
    }

    if (!block) useBlock("");
    block.exercises.push(exerciseFields({
      name: pretty(name),
      sets,
      setsLabel,
      reps,
      weight,
      rest,
      notes,
    }));
  }

  for (const item of days) {
    for (const group of item.blocks) group.exercises = collapseSets(group.exercises);
  }
  return days;
}

function parseDate(text) {
  const heading = splitDayHeading(text);
  if (heading && !heading.rest) return { key: heading.label, weekday: heading.weekday, label: heading.label };
  const match = String(text ?? "").trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  let day;
  let month;
  if (a > 12) {
    day = a;
    month = b;
  } else if (b > 12) {
    month = a;
    day = b;
  } else {
    day = a;
    month = b;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  const labels = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  return {
    key: year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
    weekday: date.getUTCDay(),
    label: labels[date.getUTCDay()],
  };
}

function expandDates(rows, map) {
  if (map.date == null || map.day != null) return { rows, map };
  const parsed = rows.map((row) => ({ row, date: parseDate(cell(row, map.date)) }));
  const unique = new Set(parsed.filter((item) => item.date).map((item) => item.date.key));
  let keep = null;
  if (unique.size > 14) {
    const latest = new Map();
    for (const item of parsed) {
      if (!item.date) continue;
      const prev = latest.get(item.date.weekday);
      if (!prev || item.date.key > prev) latest.set(item.date.weekday, item.date.key);
    }
    keep = new Set(latest.values());
  }
  const next = [];
  for (const item of parsed) {
    if (keep && item.date && !keep.has(item.date.key)) continue;
    const copy = item.row.slice();
    if (item.date) copy[map.date] = item.date.label;
    next.push(copy);
  }
  return { rows: next, map: { ...map, day: map.date } };
}

function isMostlySingleColumn(rows) {
  if (rows.length < 2) return false;
  const singles = rows.filter((row) => row.filter(Boolean).length <= 1).length;
  return singles / rows.length >= 0.7;
}

function looksPositional(rows) {
  const filled = rows.filter((row) => row.some(Boolean));
  const hits = filled.filter((row) => (row[0] || "").length > 1 && /^\d{1,2}$/.test(row[1] || "")).length;
  return hits >= 2 || (hits >= 1 && hits === filled.length);
}

function parseLoose(title, lines) {
  const days = [];
  let day = null;
  let block = null;

  function switchDay(label, weekday, rest) {
    day = makeDay(label, weekday);
    days.push(day);
    block = null;
    if (rest) {
      block = { title: asTitle(rest), exercises: [] };
      day.blocks.push(block);
    }
  }

  function useBlock(titleText) {
    block = { title: asTitle(titleText), exercises: [] };
    day.blocks.push(block);
    return block;
  }

  switchDay(title.label || "Rutina", title.weekday, title.rest);

  for (const line of lines) {
    const text = String(line ?? "").trim();
    if (!text) continue;
    const asDay = !/\d/.test(text) && text.length < 42 ? splitDayHeading(text) : null;
    if (asDay) {
      switchDay(asDay.label, asDay.weekday, asDay.rest);
      continue;
    }
    const lead = leadingDayLine(text);
    if (lead) {
      switchDay(lead.label, lead.weekday, "");
      if (lead.block) useBlock(lead.block);
      if (lead.exercise) {
        if (!block) useBlock("");
        block.exercises.push(exerciseFields(lead.exercise));
      }
      continue;
    }
    const free = parseFreeText(text);
    if (!free) continue;
    if (free.type === "heading") {
      useBlock(free.title);
      continue;
    }
    if (!block) useBlock("");
    block.exercises.push(exerciseFields(free));
  }

  for (const item of days) {
    for (const group of item.blocks) group.exercises = collapseSets(group.exercises);
  }
  return days;
}

function presentSheetName(name) {
  const n = norm(name);
  if (!n || /^hoja\s*\d+$/.test(n) || /^sheet\s*\d+$/.test(n)) {
    return { label: "Rutina", weekday: null, rest: "" };
  }
  return splitDayHeading(name) || { label: asTitle(name) || "Rutina", weekday: null, rest: "" };
}

function isIgnoredSheet(name, rows) {
  const n = norm(name);
  if (!/^(instrucciones|leeme|readme|portada|indice|index|info)$/.test(n)) return false;
  return findHeader(rows) < 0 && !looksPositional(rows);
}

function labelsInCell(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 48) return [];
  const n = norm(raw);
  const labels = [];
  for (const day of DAY_WORDS) {
    if (new RegExp("\\b(" + day.token + "|" + day.extra + ")\\b").test(n)) labels.push(day.label);
  }
  if (!labels.length) return [];
  const dayWords = new Set(DAY_WORDS.flatMap((day) => [day.token, day.extra]));
  const other = n.split(" ").filter((word) => word && !dayWords.has(word) && !/^(y|e|de|del|a|al|pecho|espalda|pierna|hombro|brazo|full|body)$/.test(word));
  if (other.length > 3) return [];
  return labels;
}

function sessionHeading(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 36) return null;
  const day = splitDayHeading(raw);
  if (day && (!day.rest || day.rest.length <= 24)) return day;
  const n = norm(raw);
  if (/^dia\s*\d+$/.test(n) || /^(push|pull|legs|upper|lower|full body)$/.test(n)) {
    return { label: asTitle(raw), weekday: null, rest: "" };
  }
  return null;
}

function leadingDayLine(text) {
  const day = splitDayHeading(text);
  if (!day || /\d/.test(text.slice(0, day.label.length + 2))) return null;
  const lead = DAY_WORDS.find((item) => item.label === day.label);
  const match = lead ? text.match(lead.lead) : null;
  const rawRest = match ? text.slice(match[0].length).replace(/^[\s\-–:|/]+/, "").trim() : "";
  if (!rawRest) return null;
  const free = parseFreeText(rawRest);
  if (free && free.type === "exercise") {
    return { label: day.label, weekday: day.weekday, block: "", exercise: free };
  }
  if (!/\d/.test(rawRest) && rawRest.length < 32) {
    return { label: day.label, weekday: day.weekday, block: asTitle(rawRest), exercise: null };
  }
  return null;
}

function rowToExercise(cells) {
  const useful = cells.map((value) => String(value || "").trim()).filter(Boolean);
  if (!useful.length) return null;
  const free = parseFreeText(useful.join(" "));
  if (free && free.type === "exercise") return exerciseFields(free);
  if (useful.length >= 2 && /[A-Za-zÁÉÍÓÚáéíóú]/.test(useful[0]) && /^\d{1,2}$/.test(useful[1])) {
    return exerciseFields({
      name: pretty(useful[0]),
      sets: clampSets(useful[1]),
      setsLabel: useful[1],
      reps: useful[2] || "",
      weight: formatWeight(useful[3] || ""),
      rest: formatRest(useful[4] || ""),
      notes: useful[5] || "",
    });
  }
  if (/[A-Za-zÁÉÍÓÚáéíóú]/.test(useful[0]) && !sessionHeading(useful[0])) {
    return exerciseFields({ name: pretty(useful[0]), sets: null, setsLabel: "", reps: "", weight: "", rest: "", notes: "" });
  }
  return null;
}

function groupExercises(label, weekday, items) {
  const day = makeDay(label, weekday);
  let block = null;
  for (const item of items) {
    const title = item.block || "";
    if (!block || norm(block.title) !== norm(title)) {
      block = { title, exercises: [] };
      day.blocks.push(block);
    }
    block.exercises.push(exerciseFields(item));
  }
  for (const group of day.blocks) group.exercises = collapseSets(group.exercises);
  day.blocks = day.blocks.filter((group) => group.exercises.length);
  return day.blocks.length ? day : null;
}

function parseWeekColumns(rows) {
  let headerIdx = -1;
  let columns = [];
  const limit = Math.min(rows.length, 12);
  for (let i = 0; i < limit; i += 1) {
    const found = [];
    rows[i].forEach((value, index) => {
      const heading = sessionHeading(value);
      if (heading) found.push({ index, heading });
    });
    const filled = rows[i].filter((value) => String(value || "").trim()).length;
    const distinct = new Set(found.map((item) => item.heading.label));
    if (distinct.size >= 2 && found.length >= filled - 1) {
      headerIdx = i;
      columns = found;
      break;
    }
  }
  if (headerIdx < 0) return null;

  const dayIndexes = new Set(columns.map((column) => column.index));
  const data = rows.slice(headerIdx + 1);
  let nameCol = null;
  const width = data.reduce((max, row) => Math.max(max, row.length), 0);
  for (let index = 0; index < width; index += 1) {
    if (dayIndexes.has(index)) continue;
    const texts = data.map((row) => String(row[index] || "").trim()).filter(Boolean);
    const words = texts.filter((text) => /[A-Za-zÁÉÍÓÚáéíóú]/.test(text) && !sessionHeading(text));
    if (words.length >= 1) {
      nameCol = index;
      break;
    }
  }

  const buckets = columns.map((column) => ({
    label: column.heading.label,
    weekday: column.heading.weekday,
    rest: column.heading.rest || "",
    items: [],
  }));
  let section = "";
  for (const row of data) {
    const nameCell = nameCol == null ? "" : String(row[nameCol] || "").trim();
    const values = columns.map((column) => String(row[column.index] || "").trim());
    const anyDay = values.some(Boolean);
    if (!anyDay && nameCell && !sessionHeading(nameCell) && !/\d/.test(nameCell) && nameCell.length < 32) {
      section = asTitle(nameCell);
      continue;
    }
    const cellsAreExercises = values.some((value) => {
      if (!value) return false;
      const parsed = parseFreeText(value);
      return parsed && parsed.type === "exercise" && /[A-Za-zÁÉÍÓÚáéíóú]{3,}/.test(parsed.name);
    });
    if (cellsAreExercises && nameCell && !/\d/.test(nameCell) && nameCell.length < 28 && !sessionHeading(nameCell)) {
      section = asTitle(nameCell);
    }
    columns.forEach((column, index) => {
      const raw = values[index];
      if (!raw || sessionHeading(raw) || /^(descanso|-|—)$/i.test(raw)) return;
      const marked = /^(x|si|sí|ok|hacer)$/i.test(raw);
      const own = !marked ? parseFreeText(raw) : null;
      const ownExercise = own && own.type === "exercise" && /[A-Za-zÁÉÍÓÚáéíóú]{3,}/.test(own.name) && !sessionHeading(own.name);
      let exercise = null;
      if (ownExercise) exercise = own;
      else if (nameCell && !sessionHeading(nameCell) && (marked || own || /\d/.test(raw))) {
        const combined = parseFreeText(nameCell + (marked ? "" : " " + raw));
        exercise = combined && combined.type === "exercise" ? combined : {
          type: "exercise",
          name: pretty(nameCell),
          sets: null,
          setsLabel: "",
          reps: "",
          weight: "",
          rest: "",
        };
      }
      if (!exercise || exercise.type !== "exercise") return;
      const block = section || column.heading.rest || "";
      buckets[index].items.push({ ...exercise, block });
    });
  }

  const days = buckets.map((bucket) => groupExercises(bucket.label, bucket.weekday, bucket.items)).filter(Boolean);
  return days.length >= 2 ? days : null;
}

function parseDayLeadingColumn(rows) {
  const filled = rows.filter((row) => row.some((value) => String(value || "").trim()));
  const hits = [];
  for (const row of filled) {
    let heading = null;
    let index = -1;
    row.forEach((value, cellIndex) => {
      if (heading) return;
      const found = sessionHeading(value);
      if (found) {
        heading = found;
        index = cellIndex;
      }
    });
    if (!heading) continue;
    const rest = row.filter((_, cellIndex) => cellIndex !== index);
    if (!rest.some((value) => String(value || "").trim())) continue;
    hits.push({ heading, rest });
  }
  if (hits.length < 2 || hits.length < filled.length * 0.5) return null;
  const groups = [];
  for (const hit of hits) {
    let group = groups[groups.length - 1];
    if (!group || group.label !== hit.heading.label) {
      group = { label: hit.heading.label, weekday: hit.heading.weekday, items: [] };
      groups.push(group);
    }
    const exercise = rowToExercise(hit.rest);
    if (!exercise) continue;
    group.items.push({ ...exercise, block: hit.heading.rest || "" });
  }
  const days = groups.map((group) => groupExercises(group.label, group.weekday, group.items)).filter(Boolean);
  return days.length >= 2 ? days : null;
}

function parseRows(sheetName, rows) {
  const source = String(sheetName || "Rutina").trim() || "Rutina";
  if (!rows || !rows.length) return [];
  if (isIgnoredSheet(source, rows)) return [];
  const byColumns = parseWeekColumns(rows);
  if (byColumns) return byColumns;
  const byLeading = parseDayLeadingColumn(rows);
  if (byLeading) return byLeading;
  const title = presentSheetName(source);
  const headerIdx = findHeader(rows);
  if (headerIdx >= 0) return parseTable(title, rows.slice(headerIdx + 1), mapColumns(rows[headerIdx]));
  if (isMostlySingleColumn(rows)) {
    const lines = rows.map((row) => row.filter(Boolean).join(" ")).filter(Boolean);
    return parseLoose(title, lines);
  }
  if (looksPositional(rows)) {
    return parseTable(title, rows, { name: 0, sets: 1, reps: 2, weight: 3, rest: 4, notes: 5 });
  }
  const lines = rows.map((row) => row.filter(Boolean).join(" ")).filter(Boolean);
  return parseLoose(title, lines);
}

function mergeDays(days) {
  const out = [];
  for (const day of days) {
    const existing = out.find((item) => norm(item.label) === norm(day.label));
    if (!existing) {
      out.push(day);
      continue;
    }
    if (existing.weekday == null && day.weekday != null) existing.weekday = day.weekday;
    existing.blocks.push(...day.blocks);
  }
  return out;
}

function sortDays(days) {
  if (!days.some((day) => day.weekday != null)) return days;
  const rank = (day) => (day.weekday == null ? 100 : (day.weekday + 6) % 7);
  return days
    .map((day, index) => ({ day, index }))
    .sort((a, b) => rank(a.day) - rank(b.day) || a.index - b.index)
    .map((item) => item.day);
}

function finalize(days, filename) {
  const warnings = [];
  let trimmed = mergeDays(days)
    .map((day) => ({
      label: day.label,
      weekday: day.weekday,
      blocks: day.blocks
        .map((block) => ({
          title: block.title || "",
          exercises: (block.exercises || []).filter((item) => item.name),
        }))
        .filter((block) => block.exercises.length),
    }))
    .filter((day) => day.blocks.length);

  trimmed = sortDays(trimmed);
  if (trimmed.length > 21) {
    trimmed = trimmed.slice(0, 21);
    warnings.push("Mostré solo los primeros 21 días.");
  }

  const seen = new Map();
  for (const day of trimmed) {
    day.key = (day.weekday == null ? "c:" : "w" + day.weekday + ":") + slug(day.label);
    for (const block of day.blocks) {
      if (block.exercises.length > 80) {
        block.exercises = block.exercises.slice(0, 80);
        warnings.push("Recorté " + day.label + " a 80 ejercicios.");
      }
      for (const ex of block.exercises) {
        const base = slug(day.label) + "/" + slug(block.title) + "/" + slug(ex.name);
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        ex.id = n === 1 ? base : base + "/" + n;
      }
    }
  }

  const exercises = trimmed.reduce(
    (sum, day) => sum + day.blocks.reduce((inner, block) => inner + block.exercises.length, 0),
    0
  );

  return {
    version: 1,
    sourceName: filename,
    importedAt: new Date().toISOString(),
    days: trimmed,
    warnings,
    stats: { days: trimmed.length, exercises },
  };
}

function fileBase(name) {
  const clean = String(name || "rutina.xlsx").replace(/\\/g, "/");
  return (clean.split("/").pop() || "rutina.xlsx").slice(0, 140);
}

function decodeText(buffer) {
  const utf8 = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (utf8.includes("\uFFFD")) return buffer.toString("latin1");
  return utf8;
}

function readWorkbook(buffer, filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") && !buffer.includes(Buffer.from("xl/"))) {
    const error = new Error("No pude leer ese archivo. Tiene que ser un Excel (.xlsx, .xls) o un CSV.");
    error.status = 400;
    throw error;
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = decodeText(buffer);
    const semi = (text.match(/;/g) || []).length;
    const comma = (text.match(/,/g) || []).length;
    return XLSX.read(text, { type: "string", FS: semi > comma ? ";" : ",", raw: false });
  }
  return XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
}

function sheetRows(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  return matrix
    .map((row) => (Array.isArray(row) ? row : []).map((value) => String(value ?? "").trim()))
    .filter((row) => row.some(Boolean));
}

function readExcelSheets(buffer, filename) {
  let workbook;
  try {
    workbook = readWorkbook(buffer, filename);
  } catch {
    const error = new Error("No pude leer ese archivo. Tiene que ser un Excel (.xlsx, .xls) o un CSV.");
    error.status = 400;
    throw error;
  }
  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = sheetRows(sheet);
    if (rows.length) sheets.push({ name: sheetName, rows });
  }
  return sheets;
}

function planFromSheets(sheets, filename) {
  const days = [];
  for (const sheet of sheets) days.push(...parseRows(sheet.name, sheet.rows));
  return finalize(days, filename);
}

function emptyPlanError(pdf) {
  const error = new Error(
    pdf
      ? "No encontré ejercicios en el PDF. Si es una foto escaneada, Tanda no puede leerla."
      : "No encontré ejercicios. Usá una columna Ejercicio, una hoja por día, o líneas como «Sentadilla 5x5 100kg»."
  );
  error.status = 422;
  return error;
}

function dayLabelsInSheets(sheets) {
  const labels = new Set();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const value of row) labelsInCell(value).forEach((label) => labels.add(label));
    }
  }
  return labels;
}

function needsAiSplit(plan, sheets) {
  const mentioned = dayLabelsInSheets(sheets);
  if (mentioned.size < 2) return false;
  const got = new Set(plan.days.map((day) => day.label));
  let matched = 0;
  mentioned.forEach((label) => {
    if (got.has(label)) matched += 1;
  });
  return matched < mentioned.size;
}

function sourceBlob(sheets) {
  return norm(sheets.map((sheet) => sheet.rows.map((row) => row.join(" ")).join(" ")).join(" "));
}

function nameIsInSource(name, blob) {
  const words = norm(name).split(" ").filter((word) => word.length > 3);
  if (!words.length) return blob.includes(norm(name));
  return words.every((word) => blob.includes(word));
}

function daysFromAi(payload, sheets) {
  if (!payload || !Array.isArray(payload.days)) return [];
  const blob = sourceBlob(sheets);
  return payload.days
    .map((day) => {
      const heading = splitDayHeading(day.label || "") || { label: asTitle(day.label || "Rutina"), weekday: null, rest: "" };
      const blocks = Array.isArray(day.blocks) && day.blocks.length ? day.blocks : [{ title: "", exercises: day.exercises || [] }];
      const items = [];
      for (const block of blocks) {
        for (const exercise of block.exercises || []) {
          const name = pretty(exercise && exercise.name);
          if (!name || !nameIsInSource(name, blob)) continue;
          items.push({
            name,
            sets: clampSets(exercise.sets),
            setsLabel: exercise.sets == null ? "" : String(exercise.sets),
            reps: exercise.reps ? String(exercise.reps) : "",
            weight: exercise.weight ? formatWeight(String(exercise.weight)) : "",
            rest: exercise.rest ? formatRest(String(exercise.rest)) : "",
            notes: exercise.notes ? String(exercise.notes).slice(0, 160) : "",
            block: asTitle(block.title || ""),
          });
        }
      }
      return groupExercises(heading.label, heading.weekday, items);
    })
    .filter(Boolean);
}

function gridText(sheets) {
  return sheets
    .map((sheet) => {
      const lines = sheet.rows
        .slice(0, 80)
        .map((row) => row.map((value) => String(value || "").trim()).filter(Boolean).join(" | "))
        .filter(Boolean);
      return "Hoja: " + sheet.name + "\n" + lines.join("\n");
    })
    .join("\n\n")
    .slice(0, 14000);
}

async function improveWithAi(plan, sheets, filename) {
  const collapsed = plan.stats.exercises > 0 && needsAiSplit(plan, sheets);
  const empty = !plan.stats.exercises;
  if (!collapsed && !empty) return plan;
  if (!process.env.XAI_API_KEY) {
    if (collapsed) {
      plan.warnings.push("Vi varios días en la planilla y quedaron juntos. Con XAI_API_KEY en el .env, el coach los separa.");
    }
    return plan;
  }
  const aiDays = daysFromAi(await askDaySplit(gridText(sheets)), sheets);
  if (aiDays.length < 2) {
    if (collapsed) plan.warnings.push("El coach no pudo separar los días de esta planilla.");
    return plan;
  }
  const aiPlan = finalize(aiDays, filename);
  const better = empty || aiPlan.stats.days > plan.stats.days;
  if (!better || !aiPlan.stats.exercises) return plan;
  aiPlan.warnings.push("Los días los separó el coach leyendo la planilla.");
  return aiPlan;
}

function parseWorkbook(buffer, filename = "rutina.xlsx") {
  const safeName = fileBase(filename);
  const plan = planFromSheets(readExcelSheets(buffer, safeName), safeName);
  if (!plan.stats.exercises) throw emptyPlanError(false);
  return plan;
}

function titleForPage(rows) {
  const first = (rows[0] || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!first || first.length > 48 || /^\d+$/.test(first)) return "Rutina";
  if (splitDayHeading(first) || !/\d/.test(first)) return first;
  return "Rutina";
}

async function parsePdfBuffer(buffer, filename) {
  const header = buffer.slice(0, 5).toString("latin1");
  if (!header.startsWith("%PDF-")) {
    const error = new Error("No pude leer ese PDF.");
    error.status = 400;
    throw error;
  }
  let extracted;
  try {
    extracted = await extractPdfPages(buffer);
  } catch {
    const error = new Error("No pude leer ese PDF. Si tiene contraseña, sacala antes de subirlo.");
    error.status = 400;
    throw error;
  }
  const sheets = extracted.pages
    .filter((rows) => rows.length)
    .map((rows) => ({ name: titleForPage(rows), rows }));
  const plan = await improveWithAi(planFromSheets(sheets, filename), sheets, filename);
  if (extracted.truncated) plan.warnings.push("Leí solo las primeras 25 páginas.");
  if (!plan.stats.exercises) throw emptyPlanError(true);
  return plan;
}

async function parseUpload(buffer, filename = "rutina.xlsx") {
  const safeName = fileBase(filename);
  if (safeName.toLowerCase().endsWith(".pdf")) return parsePdfBuffer(buffer, safeName);
  const sheets = readExcelSheets(buffer, safeName);
  const plan = await improveWithAi(planFromSheets(sheets, safeName), sheets, safeName);
  if (!plan.stats.exercises) throw emptyPlanError(false);
  return plan;
}

module.exports = {
  parseWorkbook,
  parseUpload,
  parseRows,
  parseFreeText,
  splitDayHeading,
  norm,
};
