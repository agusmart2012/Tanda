"use strict";

const MODEL = "grok-4.7";

const SYSTEM = [
  "Separás una planilla de gym en días. Respondé solo con JSON válido, sin markdown.",
  "No inventes ejercicios, series, repeticiones ni pesos que no estén escritos.",
  "Si los días son columnas, cada columna es un día y lo que está debajo es de ese día.",
  "Si el día está en una fila o en la primera columna, los ejercicios siguientes son de ese día hasta el próximo.",
  "Si una celda trae solo la dosis (4x8, 60 kg, x) y el nombre está en la misma fila, usá ese nombre.",
  "Usá los nombres de día Lunes, Martes, Miércoles, Jueves, Viernes, Sábado y Domingo cuando corresponda.",
  '{"days":[{"label":"Lunes","blocks":[{"title":"","exercises":[{"name":"Press banca","sets":4,"reps":"8","weight":"60 kg","rest":"","notes":""}]}]}]}',
  "sets es un número o null. El resto de los campos son texto. title puede ir vacío.",
].join("\n");

function extractJson(text) {
  const clean = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function askDaySplit(grid) {
  const key = process.env.XAI_API_KEY;
  const source = String(grid || "").trim();
  if (!key || source.length < 8) return null;
  let response;
  try {
    response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "low",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: source.slice(0, 14000) },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  return extractJson(content);
}

module.exports = { askDaySplit, extractJson };
