/**
 * api.js — Offline-First Data Layer (Dexie + Render API)
 *
 * Strategy per operation:
 *   READ  → IndexedDB instantly (0 ms) + API sync in background
 *   WRITE → IndexedDB instantly + enqueue to syncQueue + background API push
 *   SYNC  → drain syncQueue on app-start & on 'online' event
 */

import db from './db.js';

const BASE_URL = 'https://cashbook-api-59vg.onrender.com/api';
const FETCH_TIMEOUT_MS = 10000;

// ─── Collection name mapping ──────────────────────────────────────────────────
const collectionMap = {
    stockTransactions: 'stock-transactions',
    dueMessages: 'due-messages',
};
const toEndpoint = (name) => collectionMap[name] || name;

// Dexie table name → db table (same as schema key)
const tableFor = (collectionName) => db[collectionName];

// ─── Global Toast ─────────────────────────────────────────────────────────────
let _toastContainer = null;
const getToastContainer = () => {
    if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'api-toast-container';
        Object.assign(_toastContainer.style, {
            position: 'fixed', bottom: '80px', left: '50%',
            transform: 'translateX(-50%)', zIndex: '99999',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
            pointerEvents: 'none',
        });
        document.body.appendChild(_toastContainer);
    }
    return _toastContainer;
};

export const showToast = (message, type = 'success') => {
    const container = getToastContainer();
    const colors = {
        success: 'background:#22c55e;color:#fff',
        error: 'background:#ef4444;color:#fff',
        info: 'background:#3b82f6;color:#fff',
        warning: 'background:#f59e0b;color:#fff',
    };
    const toast = document.createElement('div');
    toast.setAttribute('style', `
        padding:10px 20px;border-radius:12px;font-size:14px;font-weight:600;
        box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:280px;text-align:center;
        opacity:0;transform:translateY(10px);
        transition:opacity 0.3s,transform 0.3s;
        pointer-events:none;${colors[type] || colors.info}
    `);
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 350);
    }, 3000);
};

// ─── Connectivity badge ───────────────────────────────────────────────────────
let _pendingCount = 0;
const updateOfflineBadge = async () => {
    _pendingCount = await db.syncQueue.count();
    let badge = document.getElementById('offline-badge');
    if (_pendingCount > 0) {
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'offline-badge';
            Object.assign(badge.style, {
                position: 'fixed', top: '12px', right: '12px', zIndex: '99998',
                background: '#f59e0b', color: '#fff', borderRadius: '20px',
                padding: '4px 12px', fontSize: '12px', fontWeight: '700',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)', pointerEvents: 'none',
            });
            document.body.appendChild(badge);
        }
        badge.textContent = `⏳ ${_pendingCount} pending`;
    } else if (badge) {
        badge.remove();
    }
};

// ─── Fetch with timeout ───────────────────────────────────────────────────────
const fetchWithTimeout = (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timer));
};

// ─── Background Sync Queue ────────────────────────────────────────────────────
export const syncPendingQueue = async () => {
    const pending = await db.syncQueue.orderBy('createdAt').toArray();
    if (pending.length === 0) return;

    let syncedCount = 0;
    for (const item of pending) {
        try {
            const endpoint = toEndpoint(item.collection);
            let res;
            if (item.op === 'DELETE') {
                res = await fetchWithTimeout(`${BASE_URL}/${endpoint}/${item.docId}`, { method: 'DELETE' });
            } else {
                res = await fetchWithTimeout(`${BASE_URL}/${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item.data),
                });
                if (res.status === 409 || res.status === 400) {
                    res = await fetchWithTimeout(`${BASE_URL}/${endpoint}/${item.docId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(item.data),
                    });
                }
            }
            if (res.ok || res.status === 201) {
                await db.syncQueue.delete(item.queueId); // delete by auto-increment PK
                syncedCount++;
            }
        } catch {
            break; // Still offline — leave in queue
        }
    }
    await updateOfflineBadge();
    if (syncedCount > 0 && (await db.syncQueue.count()) === 0) {
        showToast('☁ All data synced!', 'success');
    }
};

// Run sync on app load and whenever we go back online
window.addEventListener('online', () => {
    showToast('🌐 Connection restored — syncing...', 'info');
    syncPendingQueue();
});
window.addEventListener('offline', () => showToast('📵 Offline mode — data saved locally', 'warning'));

// Initial sync attempt (catches anything queued from last session)
setTimeout(syncPendingQueue, 3000);

// ─── Firebase-compatible shim exports ─────────────────────────────────────────
export const doc = (_db, collectionName, id) => ({ collectionName, id });
export const collection = (_db, collectionName) => ({ collectionName });
export const query = (colObj, whereObj) => ({ ...colObj, ...whereObj });
export const where = (field, op, val) => {
    if (field === 'businessId' && op === '==') return { businessId: val };
    return {};
};

// ─── onSnapshot: IndexedDB-first, then background API refresh ────────────────
export const onSnapshot = (queryObj, callback) => {
    const { collectionName, businessId } = queryObj;
    const table = tableFor(collectionName);
    if (!table) return () => { };

    const makeSnap = (rows) => ({
        docs: rows.map(item => ({ id: item.id, data: () => item })),
    });

    // ① Instant read from IndexedDB (0 ms)
    const readLocal = async () => {
        try {
            const rows = businessId
                ? await table.where('businessId').equals(businessId).toArray()
                : await table.toArray();
            rows.sort((a, b) => (b.createdAt || b.id) > (a.createdAt || a.id) ? 1 : -1);
            callback(makeSnap(rows));
        } catch { /* table might not exist yet */ }
    };
    readLocal();

    // ② Background API fetch — update IndexedDB + re-call callback
    const endpoint = toEndpoint(collectionName);
    const url = businessId
        ? `${BASE_URL}/${endpoint}/${businessId}`
        : `${BASE_URL}/${endpoint}`;

    const fetchRemote = async () => {
        try {
            const res = await fetchWithTimeout(url);
            if (!res.ok) return;
            const raw = await res.json();
            const rows = Array.isArray(raw) ? raw : (raw.data || []);
            if (rows.length === 0) return;
            // Bulk upsert into IndexedDB
            await table.bulkPut(rows);
            await readLocal(); // re-read sorted from DB
        } catch { /* offline or timeout — local data stays */ }
    };
    fetchRemote();

    const interval = setInterval(fetchRemote, 15000); // refresh every 15s
    return () => clearInterval(interval);
};

// ─── getDoc ───────────────────────────────────────────────────────────────────
export const getDoc = async (docRef) => {
    const table = tableFor(docRef.collectionName);

    // Fast: IndexedDB
    if (table) {
        const local = await table.get(docRef.id);
        if (local) return { exists: () => true, data: () => local };
    }

    // Slow: network
    try {
        const endpoint = toEndpoint(docRef.collectionName);
        const res = await fetchWithTimeout(`${BASE_URL}/${endpoint}/${docRef.id}`);
        if (!res.ok) return { exists: () => false, data: () => null };
        const data = await res.json();
        if (table) await table.put(data);
        return { exists: () => true, data: () => data };
    } catch {
        return { exists: () => false, data: () => null };
    }
};

// ─── setDoc: IndexedDB instantly + enqueue for API ───────────────────────────
export const setDoc = async (docRef, data, { silent = false } = {}) => {
    const { collectionName, id } = docRef;
    const payload = { ...data, id };
    const table = tableFor(collectionName);

    // ① Write to IndexedDB immediately — UI updates at 0 ms
    if (table) await table.put(payload);

    // ② Enqueue for API sync
    await db.syncQueue.add({
        collection: collectionName,
        docId: id,
        op: 'POST',
        data: payload,
        createdAt: Date.now(),
    });
    await updateOfflineBadge();

    // ③ Try to push right now (background, non-blocking)
    const endpoint = toEndpoint(collectionName);

    // Helper: remove this doc's pending entries from syncQueue
    const clearFromQueue = async () => {
        // Use [collection+docId] compound index (defined in db.js v2)
        const keys = await db.syncQueue
            .where('[collection+docId]').equals([collectionName, id])
            .primaryKeys();
        if (keys.length) await db.syncQueue.bulkDelete(keys);
        await updateOfflineBadge();
    };

    fetchWithTimeout(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(async (res) => {
        if (res.ok || res.status === 201) {
            await clearFromQueue();
            if (!silent) showToast('✓ Saved!', 'success');
        } else if (res.status === 409 || res.status === 400) {
            // Conflict → try PUT
            fetchWithTimeout(`${BASE_URL}/${endpoint}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).then(async (r2) => {
                if (r2.ok) {
                    await clearFromQueue();
                    if (!silent) showToast('✓ Saved!', 'success');
                }
            }).catch(() => { });
        }
    }).catch(() => {
        // Offline — item already in queue, will sync when back online
        if (!silent) showToast('📵 Saved offline — will sync later', 'warning');
    });
};

// ─── updateDoc ────────────────────────────────────────────────────────────────
export const updateDoc = async (docRef, data) => {
    const { collectionName, id } = docRef;
    const table = tableFor(collectionName);

    // Patch IndexedDB record
    if (table) {
        const existing = (await table.get(id)) || {};
        await table.put({ ...existing, ...data, id });
    }

    // Background PUT
    const endpoint = toEndpoint(collectionName);
    fetchWithTimeout(`${BASE_URL}/${endpoint}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }).catch(() => {
        // Enqueue if offline
        db.syncQueue.add({
            collection: collectionName, docId: id,
            op: 'PUT', data, createdAt: Date.now(),
        }).then(updateOfflineBadge);
    });
};

// ─── deleteDoc ────────────────────────────────────────────────────────────────
export const deleteDoc = async (docRef) => {
    const { collectionName, id } = docRef;
    const table = tableFor(collectionName);
    if (table) await table.delete(id);

    const endpoint = toEndpoint(collectionName);
    fetchWithTimeout(`${BASE_URL}/${endpoint}/${id}`, { method: 'DELETE' })
        .catch(() => {
            db.syncQueue.add({
                collection: collectionName, docId: id,
                op: 'DELETE', data: null, createdAt: Date.now(),
            }).then(updateOfflineBadge);
        });
};
