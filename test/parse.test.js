"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { parseWorkbook, parseRows } = require("../lib/parse");
const { sampleBuffer } = require("../scripts/make-sample");

function book(sheets, bookType = "xlsx") {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  }
  return XLSX.write(workbook, { type: "buffer", bookType });
}

function names(plan, label) {
  const day = plan.days.find((item) => item.label === label);
  assert.ok(day, "falta el día " + label + " en " + plan.days.map((item) => item.label).join(", "));
  return day.blocks.flatMap((block) => block.exercises.map((item) => item.name));
}

test("el ejemplo tiene cuatro días y salta instrucciones", () => {
  const plan = parseWorkbook(sampleBuffer(), "rutina-ejemplo.xlsx");
  assert.deepEqual(plan.days.map((day) => day.label), ["Lunes", "Martes", "Jueves", "Viernes"]);
  assert.equal(plan.days[0].weekday, 1);
  assert.equal(plan.days[0].blocks[0].title, "Pecho");
  assert.equal(names(plan, "Lunes")[0], "Press banca");
  const press = plan.days[0].blocks[0].exercises[0];
  assert.equal(press.sets, 4);
  assert.equal(press.reps, "8-10");
  assert.equal(press.weight, "60 kg");
  assert.equal(press.rest, "90 s");
  const jueves = plan.days.find((day) => day.label === "Jueves");
  assert.deepEqual(jueves.blocks.map((block) => block.title), ["Cuádriceps", "Posterior"]);
  assert.equal(jueves.blocks[0].exercises[0].name, "Sentadilla con barra");
  const dominadas = plan.days.find((day) => day.label === "Martes").blocks[0].exercises[0];
  assert.equal(dominadas.rest, "2 min");
});

test("una sola hoja con columna Día", () => {
  const buffer = book([
    [
      "Rutina",
      [
        ["Día", "Ejercicio", "Series", "Reps", "Peso"],
        ["Lunes", "Press banca", "4", "8", "60"],
        ["lunes", "Fondos", "3", "10", ""],
        ["Martes", "Sentadilla", "5", "5", "100"],
      ],
    ],
  ]);
  const plan = parseWorkbook(buffer, "semana.xlsx");
  assert.deepEqual(names(plan, "Lunes"), ["Press banca", "Fondos"]);
  assert.deepEqual(names(plan, "Martes"), ["Sentadilla"]);
  assert.equal(plan.days.find((day) => day.label === "Martes").weekday, 2);
});

test("lista suelta y hojas Push Pull sin día de semana", () => {
  const loose = parseRows("Notas", [
    ["LUNES"],
    ["Press banca 4x8 60kg descanso 90s"],
    ["Plancha 45s"],
    ["MARTES - PIERNA"],
    ["Sentadilla 5x5 100kg"],
  ]);
  const lunes = loose.find((day) => day.label === "Lunes");
  const martes = loose.find((day) => day.label === "Martes");
  const block = lunes.blocks[lunes.blocks.length - 1];
  assert.equal(block.exercises[0].name, "Press banca");
  assert.equal(block.exercises[0].sets, 4);
  assert.equal(block.exercises[0].weight, "60 kg");
  assert.equal(block.exercises[0].rest, "90 s");
  assert.equal(block.exercises[1].reps, "45 s");
  assert.equal(martes.blocks[0].title, "Pierna");
  assert.equal(martes.blocks[0].exercises[0].name, "Sentadilla");

  const merged = parseWorkbook(
    book([
      ["Push", [["Press banca", "4", "8", "60"]]],
      ["Pull", [["Remo", "4", "10", "50"]]],
    ]),
    "ciclo.xlsx"
  );
  assert.deepEqual(merged.days.map((day) => day.label), ["Push", "Pull"]);
  assert.equal(merged.days[0].weekday, null);
  assert.equal(merged.days[0].blocks[0].exercises[0].weight, "60 kg");
});

test("filas de una serie se juntan y el CSV con punto y coma entra", () => {
  const rows = parseRows("Lunes", [
    ["Ejercicio", "Reps", "Peso"],
    ["Sentadilla", "5", "100"],
    ["Sentadilla", "5", "100"],
    ["Sentadilla", "5", "100"],
    ["Sentadilla", "4", "100"],
    ["Zancada", "10", "16"],
  ]);
  assert.equal(rows[0].blocks[0].exercises.length, 2);
  assert.equal(rows[0].blocks[0].exercises[0].sets, 4);
  assert.equal(rows[0].blocks[0].exercises[0].reps, "4-5");

  const csv = "Dia;Ejercicio;Series;Reps\nLunes;Press banca;4;8\nMartes;Sentadilla;5;5\n";
  const plan = parseWorkbook(Buffer.from(csv, "utf8"), "rutina.csv");
  assert.deepEqual(plan.days.map((day) => day.label), ["Lunes", "Martes"]);
});

test("sin ejercicios avisa, y un archivo roto también", () => {
  assert.throws(() => parseWorkbook(Buffer.from("hola"), "nota.csv"), (error) => error.status === 422);
  assert.throws(() => parseWorkbook(Buffer.from("PK esto no es un zip"), "roto.xlsx"), (error) => error.status === 400);
});

test("un historial largo se queda con la última fecha de cada día", () => {
  const rows = [["Fecha", "Ejercicio", "Series", "Reps"]];
  let monday = new Date(Date.UTC(2026, 0, 1));
  while (monday.getUTCDay() !== 1) monday = new Date(monday.getTime() + 86400000);
  for (let i = 0; i < 16; i += 1) {
    const date = new Date(monday.getTime() + i * 7 * 86400000);
    const stamp = date.getUTCDate() + "/" + (date.getUTCMonth() + 1) + "/" + date.getUTCFullYear();
    rows.push([stamp, i === 15 ? "Press nuevo" : "Press viejo", "4", "8"]);
  }
  const tuesday = new Date(monday.getTime() + 15 * 7 * 86400000 + 86400000);
  rows.push([
    tuesday.getUTCDate() + "/" + (tuesday.getUTCMonth() + 1) + "/" + tuesday.getUTCFullYear(),
    "Sentadilla nueva",
    "5",
    "5",
  ]);
  const plan = parseWorkbook(book([["Historial", rows]]), "historial.xlsx");
  assert.deepEqual(names(plan, "Lunes"), ["Press nuevo"]);
  assert.deepEqual(names(plan, "Martes"), ["Sentadilla nueva"]);
});
