/**
 * Offline queue.
 *
 * A farmer standing in a field with no signal is the normal case, not an error.
 * Harvests are written to IndexedDB and drained when the browser comes back
 * online. Each carries a client-generated idempotency key, so a retry that
 * actually did reach the server the first time will not create a second batch.
 */

const DB_NAME = "crop-story";
const STORE = "pending-harvests";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "idempotencyKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function queueHarvest(body: Record<string, unknown>): Promise<void> {
  await tx("readwrite", (s) => s.put({ ...body, queuedAt: Date.now() }));
}

export async function pendingCount(): Promise<number> {
  try {
    return await tx<number>("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

export async function drainQueue(): Promise<number> {
  let sent = 0;
  const all = await tx<Record<string, unknown>[]>("readonly", (s) => s.getAll());

  for (const item of all) {
    const { queuedAt: _queuedAt, ...body } = item as Record<string, unknown> & { queuedAt: number };
    try {
      const res = await fetch("/api/harvests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // 4xx means this submission will never succeed — drop it rather than
      // retrying forever. 5xx and network errors stay queued.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await tx("readwrite", (s) => s.delete(body.idempotencyKey as string));
        if (res.ok) sent++;
      }
    } catch {
      break; // still offline; try again on the next online event
    }
  }
  return sent;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void drainQueue();
  });
}
