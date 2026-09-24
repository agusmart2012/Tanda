"use strict";

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const sheets = [
  [
    "Lunes - Pecho",
    [
      ["Rutina de fuerza"],
      ["Ejercicio", "Series", "Repeticiones", "Peso", "Descanso", "Notas"],
      ["Press banca", "4", "8-10", "60", "90", "Escápulas juntas"],
      ["Press inclinado con mancuernas", "3", "10", "22", "75", ""],
      ["Aperturas en polea", "3", "12", "15", "60", ""],
      ["Fondos en paralelas", "3", "al fallo", "", "90", ""],
      ["Extensión de tríceps en polea", "3", "12", "25", "60", ""],
    ],
  ],
  [
    "Martes",
    [
      ["Ejercicio", "Series", "Reps", "Peso", "Descanso"],
      ["Dominadas", "4", "6", "", "2"],
      ["Remo con barra", "4", "8", "70", "90"],
      ["Jalón al pecho", "3", "10", "50", "75"],
      ["Remo unilateral", "3", "12", "20", "60"],
      ["Curl de bíceps", "3", "10", "14", "60"],
    ],
  ],
  [
    "Jueves",
    [
      ["Ejercicio", "Series", "Reps", "Kg", "Descanso"],
      ["CUÁDRICEPS", "", "", "", ""],
      ["Sentadilla con barra", "5", "5", "100", "180"],
      ["Prensa", "3", "12", "140", "90"],
      ["Zancadas", "3", "10", "16", "60"],
      ["POSTERIOR", "", "", "", ""],
      ["Peso muerto rumano", "4", "8", "80", "120"],
      ["Gemelos de pie", "4", "12", "40", "45"],
    ],
  ],
  [
    "Viernes",
    [
      ["Ejercicio", "Series", "Reps", "Peso", "Descanso"],
      ["Press militar", "4", "8", "40", "90"],
      ["Vuelos laterales", "4", "12", "8", "60"],
      ["Face pull", "3", "15", "20", "60"],
      ["Elevaciones posteriores", "3", "12", "6", "45"],
    ],
  ],
  ["Instrucciones", [["Dejá una hoja por día y una fila por ejercicio."]]],
];

function sampleBuffer() {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function writeSample() {
  const dir = path.join(__dirname, "..", "public", "sample");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "rutina-ejemplo.xlsx");
  fs.writeFileSync(file, sampleBuffer());
  return file;
}

if (require.main === module) {
  console.log(writeSample());
}

module.exports = { sampleBuffer, writeSample, sheets };
