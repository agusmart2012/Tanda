"use strict";

const { pathToFileURL } = require("url");

const MAX_PAGES = 25;

let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
        require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
      ).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function itemsToRows(items) {
  const pieces = [];
  for (const item of items || []) {
    if (!item || typeof item.str !== "string") continue;
    const text = item.str.replace(/\s+/g, " ");
    const transform = item.transform || [];
    const height = item.height || Math.abs(transform[3] || 0) || 10;
    if (!text.trim()) {
      if (item.hasEOL && pieces.length) pieces[pieces.length - 1].eol = true;
      continue;
    }
    pieces.push({
      text,
      x: transform[4] || 0,
      y: transform[5] || 0,
      width: item.width || text.length * height * 0.45,
      height,
      eol: Boolean(item.hasEOL),
    });
  }
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  let current = null;
  for (const piece of pieces) {
    const threshold = Math.max(2, Math.min(current ? current.height : piece.height, piece.height) * 0.55);
    const sameLine = current && !current.closed && Math.abs(current.y - piece.y) <= threshold;
    if (!sameLine) {
      current = { y: piece.y, height: piece.height, items: [], closed: false };
      lines.push(current);
    } else {
      current.height = Math.max(current.height, piece.height);
    }
    current.items.push(piece);
    if (piece.eol) current.closed = true;
  }

  return lines.map((line) => lineToCells(line.items)).filter((row) => row.length);
}

function lineToCells(items) {
  const ordered = items.slice().sort((a, b) => a.x - b.x);
  const cells = [];
  let buffer = "";
  let lastEnd = null;
  let font = 10;
  for (const item of ordered) {
    font = item.height || font;
    const gap = lastEnd == null ? 0 : item.x - lastEnd;
    const split = lastEnd != null && gap > Math.max(12, font * 1.1);
    if (split) {
      pushCell(cells, buffer);
      buffer = item.text;
    } else {
      if (buffer && gap > font * 0.18 && !buffer.endsWith(" ") && !item.text.startsWith(" ")) buffer += " ";
      buffer += item.text;
    }
    lastEnd = item.x + item.width;
  }
  pushCell(cells, buffer);
  return cells;
}

function pushCell(cells, value) {
  const parts = String(value || "")
    .split(/\t+| {2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  cells.push(...parts);
}

async function extractPdfPages(buffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  const total = doc.numPages;
  const pages = [];
  try {
    const limit = Math.min(total, MAX_PAGES);
    for (let number = 1; number <= limit; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(itemsToRows(content.items));
    }
  } finally {
    await doc.destroy();
  }
  return { pages, truncated: total > MAX_PAGES };
}

module.exports = { extractPdfPages, itemsToRows };
