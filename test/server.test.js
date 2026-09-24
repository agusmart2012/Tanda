"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server");
const { sampleBuffer } = require("../scripts/make-sample");

function listen() {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, { method = "GET", path = "/", body = null, headers = {} }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = require("http").request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const type = res.headers["content-type"] || "";
          resolve({
            status: res.statusCode,
            raw,
            json: type.includes("json") ? JSON.parse(raw.toString("utf8")) : null,
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

test("importa el ejemplo, sirve la app y el coach explica si falta la clave", async () => {
  const server = await listen();
  try {
    const health = await request(server, { path: "/api/health" });
    assert.equal(health.status, 200);
    assert.equal(typeof health.json.ai, "boolean");

    const page = await request(server, { path: "/" });
    assert.equal(page.status, 200);
    const html = page.raw.toString("utf8");
    assert.match(html, /Tanda/);
    assert.match(html, /viewport-fit=cover/);

    const imported = await request(server, {
      method: "POST",
      path: "/api/import",
      body: sampleBuffer(),
      headers: { "X-Filename": encodeURIComponent("rutina-ejemplo.xlsx") },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.json.stats.days, 4);
    assert.ok(imported.json.stats.exercises >= 16);

    if (!process.env.XAI_API_KEY) {
      const coach = await request(server, {
        method: "POST",
        path: "/api/coach",
        body: Buffer.from(JSON.stringify({ messages: [{ role: "user", content: "¿Cómo caliento?" }], context: "Lunes" })),
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(coach.status, 503);
      assert.match(coach.json.message, /XAI_API_KEY/);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
