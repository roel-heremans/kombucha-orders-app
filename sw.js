// Pass-through service worker: present only so browsers treat the site as an
// installable app. It caches nothing, so a new GitHub Pages deploy is always
// picked up; Firestore's own persistent cache handles offline data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
