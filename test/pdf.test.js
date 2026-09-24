"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { parseUpload, parseFreeText } = require("../lib/parse");
const { createServer } = require("../server");

async function routinePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const lunes = doc.addPage([595, 842]);
  lunes.drawText("LUNES - PECHO", { x: 50, y: 760, size: 16, font: bold });
  lunes.drawText("Ejercicio", { x: 50, y: 720, size: 12, font: bold });
  lunes.drawText("Series", { x: 260, y: 720, size: 12, font: bold });
  lunes.drawText("Reps", { x: 340, y: 720, size: 12, font: bold });
  lunes.drawText("Peso", { x: 420, y: 720, size: 12, font: bold });
  lunes.drawText("Press banca", { x: 50, y: 690, size: 12, font });
  lunes.drawText("4", { x: 260, y: 690, size: 12, font });
  lunes.drawText("8", { x: 340, y: 690, size: 12, font });
  lunes.drawText("60", { x: 420, y: 690, size: 12, font });
  lunes.drawText("Fondos", { x: 50, y: 660, size: 12, font });
  lunes.drawText("3", { x: 260, y: 660, size: 12, font });
  lunes.drawText("10", { x: 340, y: 660, size: 12, font });

  const martes = doc.addPage([595, 842]);
  martes.drawText("MARTES", { x: 50, y: 760, size: 16, font: bold });
  martes.drawText("Sentadilla 5x5 100kg", { x: 50, y: 720, size: 12, font });
  martes.drawText("Peso muerto rumano 4x8 80kg", { x: 50, y: 690, size: 12, font });

  return Buffer.from(await doc.save());
}

test("una línea con columnas sueltas se lee como ejercicio", () => {
  const parsed = parseFreeText("Press banca 4 8 60");
  assert.equal(parsed.type, "exercise");
  assert.equal(parsed.name, "Press banca");
  assert.equal(parsed.sets, 4);
  assert.equal(parsed.reps, "8");
  assert.equal(parsed.weight, "60 kg");
});

test("un PDF con tabla y otra página de texto arma los días", async () => {
  const plan = await parseUpload(await routinePdf(), "rutina.pdf");
  assert.deepEqual(plan.days.map((day) => day.label), ["Lunes", "Martes"]);
  assert.equal(plan.days[0].weekday, 1);
  assert.equal(plan.days[0].blocks[0].title, "Pecho");
  const press = plan.days[0].blocks[0].exercises[0];
  assert.equal(press.name, "Press banca");
  assert.equal(press.sets, 4);
  assert.equal(press.reps, "8");
  assert.equal(press.weight, "60 kg");
  assert.deepEqual(
    plan.days[1].blocks.flatMap((block) => block.exercises.map((item) => item.name)),
    ["Sentadilla", "Peso muerto rumano"]
  );
  assert.equal(plan.days[1].blocks[0].exercises[0].weight, "100 kg");
});

test("un PDF semanal en columnas no junta los días", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  page.drawText("Lunes", { x: 50, y: 760, size: 14, font: bold });
  page.drawText("Martes", { x: 280, y: 760, size: 14, font: bold });
  page.drawText("Press banca 4x8 60kg", { x: 50, y: 720, size: 11, font });
  page.drawText("Sentadilla 5x5 100kg", { x: 280, y: 720, size: 11, font });
  page.drawText("Fondos 3x10", { x: 50, y: 690, size: 11, font });
  page.drawText("Prensa 3x12", { x: 280, y: 690, size: 11, font });
  const plan = await parseUpload(Buffer.from(await doc.save()), "semana.pdf");
  assert.deepEqual(plan.days.map((day) => day.label), ["Lunes", "Martes"]);
  assert.deepEqual(
    plan.days[0].blocks.flatMap((block) => block.exercises.map((item) => item.name)),
    ["Press banca", "Fondos"]
  );
  assert.deepEqual(
    plan.days[1].blocks.flatMap((block) => block.exercises.map((item) => item.name)),
    ["Sentadilla", "Prensa"]
  );
});

test("un PDF roto o vacío avisa", async () => {
  await assert.rejects(parseUpload(Buffer.from("hola"), "nota.pdf"), (error) => error.status === 400);
  const doc = await PDFDocument.create();
  doc.addPage();
  const empty = Buffer.from(await doc.save());
  await assert.rejects(parseUpload(empty, "vacio.pdf"), (error) => error.status === 422);
});

test("el servidor importa un PDF", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const body = await routinePdf();
    const response = await new Promise((resolve, reject) => {
      const req = require("http").request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/import",
          method: "POST",
          headers: { "X-Filename": encodeURIComponent("rutina.pdf") },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          });
        }
      );
      req.on("error", reject);
      req.end(body);
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.stats.days, 2);
    assert.equal(response.json.stats.exercises, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
