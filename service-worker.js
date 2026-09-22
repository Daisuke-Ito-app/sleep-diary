"use strict";

const CACHE_NAME = "sleep-diary-final-pwa-v2";
const BASE = new URL("./", self.location.href);
const ALLOWED_PATHS = new Set([
  new URL("./", BASE).pathname,
  new URL("./index.html", BASE).pathname,
  new URL("./style.css", BASE).pathname,
  new URL("./app.js", BASE).pathname,
  new URL("./manifest.webmanifest", BASE).pathname,
  new URL("./icon-192.png", BASE).pathname,
  new URL("./icon-512.png", BASE).pathname
]);

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") {
    event.respondWith(new Response("Blocked", {status: 403, statusText: "Forbidden"}));
    return;
  }
  if (url.origin !== self.location.origin) {
    event.respondWith(new Response("Blocked", {status: 403, statusText: "Forbidden"}));
    return;
  }
  if (!ALLOWED_PATHS.has(url.pathname)) {
    event.respondWith(new Response("Blocked", {status: 403, statusText: "Forbidden"}));
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req, {credentials: "same-origin", cache: "no-store"}).then(response => {
        if (!response || !response.ok || response.type === "opaque") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return response;
      });
    })
  );
});
