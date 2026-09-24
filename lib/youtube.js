"use strict";

const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

function walkVideos(node, found) {
  if (!node || typeof node !== "object") return;
  if (node.videoRenderer && node.videoRenderer.videoId) {
    const video = node.videoRenderer;
    const text = (runs) => (Array.isArray(runs) ? runs.map((part) => part.text || "").join("") : "");
    found.push({
      id: String(video.videoId),
      title: text(video.title && video.title.runs) || (video.title && video.title.simpleText) || "",
      author: text(video.ownerText && video.ownerText.runs) || text(video.longBylineText && video.longBylineText.runs) || "",
      length: (video.lengthText && video.lengthText.simpleText) || "",
    });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walkVideos(value, found);
  }
}

function uniqueVideos(list) {
  const out = [];
  const seen = new Set();
  for (const video of list) {
    if (!/^[\w-]{11}$/.test(video.id) || seen.has(video.id) || !video.title) continue;
    seen.add(video.id);
    out.push({
      id: video.id,
      title: video.title.slice(0, 140),
      author: video.author.slice(0, 80),
      length: video.length.slice(0, 16),
    });
  }
  return out;
}

async function searchVideos(rawQuery) {
  const raw = String(rawQuery || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (raw.length < 2) return [];
  const query = /t[eé]cnica|c[oó]mo hacer|how to/i.test(raw) ? raw : raw + " técnica ejercicio";
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.videos;

  const response = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": "es-AR,es;q=0.9",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20250923.00.00",
          hl: "es",
          gl: "AR",
        },
      },
      query,
    }),
  });

  if (!response.ok) {
    const error = new Error("YouTube no respondió (" + response.status + ").");
    error.status = 502;
    throw error;
  }

  const json = await response.json();
  const found = [];
  walkVideos(json, found);
  const videos = uniqueVideos(found).slice(0, 6);
  cache.set(key, { at: Date.now(), videos });
  return videos;
}

module.exports = { searchVideos };
