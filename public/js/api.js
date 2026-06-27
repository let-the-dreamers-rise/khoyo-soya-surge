// API client + offline-first queue (IndexedDB). When offline, new reports are
// queued locally and flushed to /api/sync/batch on reconnect.
const API = {
  online: navigator.onLine,

  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },

  // ---- IndexedDB queue ----
  _db: null,
  async db() {
    if (this._db) return this._db;
    this._db = await new Promise((res, rej) => {
      const req = indexedDB.open("khoya-paya", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return this._db;
  },
  async enqueue(record) {
    const db = await this.db();
    return new Promise((res, rej) => {
      const tx = db.transaction("queue", "readwrite");
      tx.objectStore("queue").add({ record, ts: Date.now() });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  },
  async queued() {
    const db = await this.db();
    return new Promise((res) => {
      const out = [];
      db.transaction("queue").objectStore("queue").openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (c) { out.push(c.value); c.continue(); } else res(out);
      };
    });
  },
  async clearQueue() {
    const db = await this.db();
    return new Promise((res) => { const tx = db.transaction("queue", "readwrite"); tx.objectStore("queue").clear(); tx.oncomplete = res; });
  },

  /** Create a case — online directly, offline into the local queue. */
  async createCase(record, forceOffline = false) {
    if (this.online && !forceOffline) return { mode: "online", ...(await this.post("/api/cases", record)) };
    await this.enqueue(record);
    const n = (await this.queued()).length;
    return { mode: "queued", queued: n, case_id: "(pending sync)" };
  },

  /** Flush the offline queue through /api/sync/batch. */
  async flush() {
    const items = await this.queued();
    if (!items.length) return { uploaded: 0, lane_flips: 0, results: [] };
    const res = await this.post("/api/sync/batch", { cases: items.map((i) => i.record) });
    await this.clearQueue();
    return res;
  },
};

window.addEventListener("online", () => { API.online = true; document.dispatchEvent(new Event("net:online")); });
window.addEventListener("offline", () => { API.online = false; document.dispatchEvent(new Event("net:offline")); });
