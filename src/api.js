/**
 * api.js — Offline-First Data Layer (Dexie + Render API)
 *
 * Strategy:
 *   READ   → IndexedDB instantly (0ms) + API sync in background
 *   WRITE  → IndexedDB instantly + enqueue + background push
 *   SYNC   → drain syncQueue; skip items with retryCount >= MAX_RETRIES
 *   MANUAL → deleteSyncQueueItem(queueId) / clearFailedItems()
 */

import db from './db.js';

const BASE_URL = 'https://cashbook-api-59vg.onrender.com/api';
const FETCH_TIMEOUT = 12000;  // 12 s — Render cold-start can take ~10 s
const MAX_RETRIES = 3;      // skip permanently after 3 failures

// ─── Collection mapping ───────────────────────────────────────────────────────
const collectionMap = { stockTransactions: 'stock-transactions', dueMessages: 'due-messages' };
const toEndpoint = (n) => collectionMap[n] || n;
const tableFor = (n) => db[n];

// ─── Global Toast ─────────────────────────────────────────────────────────────
let _toastEl = null;
const getToastContainer = () => {
    if (!_toastEl) {
        _toastEl = document.createElement('div');
        Object.assign(_toastEl.style, {
            position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
            zIndex: '99999', display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '8px', pointerEvents: 'none',
        });
        document.body.appendChild(_toastEl);
    }
    return _toastEl;
};

export const showToast = (msg, type = 'success') => {
    const c = getToastContainer();
    const colors = { success: '#22c55e', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
    const el = document.createElement('div');
    el.setAttribute('style', `
        padding:10px 20px;border-radius:12px;font-size:14px;font-weight:600;
        box-shadow:0 4px 20px rgba(0,0,0,.3);max-width:300px;text-align:center;
        opacity:0;transform:translateY(10px);transition:opacity .3s,transform .3s;
        pointer-events:none;background:${colors[type] || colors.info};color:#fff;
    `);
    el.textContent = msg;
    c.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => {
        el.style.opacity = '0'; el.style.transform = 'translateY(10px)';
        setTimeout(() => el.remove(), 350);
    }, 3500);
};

// ─── Offline Badge (clickable → opens queue manager) ─────────────────────────
let _badge = null;
export const updateOfflineBadge = async () => {
    const total = await db.syncQueue.count();
    const failed = await db.syncQueue.where('retryCount').aboveOrEqual(MAX_RETRIES).count();
    const pending = total - failed;

    if (total === 0) { _badge?.remove(); _badge = null; return; }

    if (!_badge) {
        _badge = document.createElement('div');
        _badge.id = 'offline-badge';
        Object.assign(_badge.style, {
            position: 'fixed', top: '12px', right: '12px', zIndex: '99998',
            borderRadius: '20px', padding: '5px 14px', fontSize: '12px', fontWeight: '700',
            boxShadow: '0 2px 8px rgba(0,0,0,.3)', cursor: 'pointer',
            transition: 'background .3s',
        });
        _badge.title = 'Click to manage pending sync items';
        _badge.onclick = () => window.dispatchEvent(new CustomEvent('openSyncQueue'));
        document.body.appendChild(_badge);
    }
    if (failed > 0) {
        _badge.style.background = '#ef4444';
        _badge.textContent = `❌ ${failed} failed · ⏳ ${pending} pending`;
    } else {
        _badge.style.background = '#f59e0b';
        _badge.textContent = `⏳ ${pending} pending`;
    }
};

// ─── Sync Queue helpers (exported for UI) ────────────────────────────────────
export const getSyncQueue = () => db.syncQueue.orderBy('createdAt').toArray();
export const deleteSyncQueueItem = (queueId) =>
    db.syncQueue.delete(queueId).then(updateOfflineBadge);
export const clearFailedItems = () =>
    db.syncQueue.where('retryCount').aboveOrEqual(MAX_RETRIES).delete().then(updateOfflineBadge);
export const clearAllPending = () =>
    db.syncQueue.clear().then(updateOfflineBadge);

// ─── fetchWithTimeout ─────────────────────────────────────────────────────────
const fetchWithTimeout = (url, opts = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
};

// ─── Background Sync Queue ────────────────────────────────────────────────────
let _syncing = false;

export const syncPendingQueue = async () => {
    if (_syncing || !navigator.onLine) return;
    _syncing = true;

    try {
        // Process in creation order; items with retryCount >= MAX_RETRIES are skipped
        const all = await db.syncQueue.orderBy('createdAt').toArray();
        let synced = 0;

        for (const item of all) {
            // Skip permanently-failed items (user must delete manually)
            if ((item.retryCount || 0) >= MAX_RETRIES) continue;

            try {
                const endpoint = toEndpoint(item.collection);
                let res;

                if (item.op === 'DELETE') {
                    res = await fetchWithTimeout(`${BASE_URL}/${endpoint}/${item.docId}`,
                        { method: 'DELETE' });
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
                    await db.syncQueue.delete(item.queueId);
                    synced++;
                } else {
                    // Non-fatal HTTP error — increment retry counter
                    await db.syncQueue.update(item.queueId, {
                        retryCount: (item.retryCount || 0) + 1,
                        lastError: `HTTP ${res.status}`,
                    });
                }
            } catch (err) {
                if (err.name === 'AbortError') {
                    // Timeout → increment retries
                    await db.syncQueue.update(item.queueId, {
                        retryCount: (item.retryCount || 0) + 1,
                        lastError: 'Timeout',
                    });
                }
                // Network down — stop trying for now
                if (!navigator.onLine) break;
            }
        }

        await updateOfflineBadge();
        const remaining = await db.syncQueue.where('retryCount').below(MAX_RETRIES).count();
        if (synced > 0 && remaining === 0) showToast('☁ All data synced!', 'success');

        const failed = await db.syncQueue.where('retryCount').aboveOrEqual(MAX_RETRIES).count();
        if (failed > 0) showToast(`❌ ${failed} item(s) failed — tap badge to manage`, 'error');
    } finally {
        _syncing = false;
    }
};

// Run sync non-blocking (after idle or after 4s)
const scheduleSync = () => {
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => syncPendingQueue(), { timeout: 5000 });
    } else {
        setTimeout(syncPendingQueue, 4000);
    }
};

window.addEventListener('online', () => { showToast('🌐 Online — syncing...', 'info'); scheduleSync(); });
window.addEventListener('offline', () => showToast('📵 Offline — data saved locally', 'warning'));
scheduleSync(); // initial run on load

// ─── Firebase-compatible shim ─────────────────────────────────────────────────
export const doc = (_db, col, id) => ({ collectionName: col, id });
export const collection = (_db, col) => ({ collectionName: col });
export const query = (col, where) => ({ ...col, ...where });
export const where = (field, op, val) =>
    (field === 'businessId' && op === '==') ? { businessId: val } : {};

// ─── onSnapshot ──────────────────────────────────────────────────────────────
export const onSnapshot = (queryObj, callback) => {
    const { collectionName, businessId } = queryObj;
    const table = tableFor(collectionName);
    if (!table) return () => { };

    const makeSnap = (rows) => ({
        docs: rows.map(item => ({ id: item.id, data: () => item })),
    });

    const readLocal = async () => {
        try {
            let rows = businessId
                ? await table.where('businessId').equals(businessId).toArray()
                : await table.toArray();
            rows.sort((a, b) => ((b.createdAt || b.id) > (a.createdAt || a.id) ? 1 : -1));
            callback(makeSnap(rows));
        } catch { /* table not ready yet */ }
    };
    readLocal();

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
            await table.bulkPut(rows);
            await readLocal();
        } catch { /* offline — use local */ }
    };
    fetchRemote();
    const iv = setInterval(fetchRemote, 15000);
    return () => clearInterval(iv);
};

// ─── getDoc ───────────────────────────────────────────────────────────────────
export const getDoc = async (docRef) => {
    const table = tableFor(docRef.collectionName);
    if (table) {
        const local = await table.get(docRef.id);
        if (local) return { exists: () => true, data: () => local };
    }
    try {
        const res = await fetchWithTimeout(
            `${BASE_URL}/${toEndpoint(docRef.collectionName)}/${docRef.id}`);
        if (!res.ok) return { exists: () => false, data: () => null };
        const data = await res.json();
        if (table) await table.put(data);
        return { exists: () => true, data: () => data };
    } catch {
        return { exists: () => false, data: () => null };
    }
};

// ─── Helper: clear this docId's queue entries using compound index ────────────
const clearFromQueue = async (collectionName, id) => {
    const keys = await db.syncQueue
        .where('[collection+docId]').equals([collectionName, id])
        .primaryKeys();
    if (keys.length) await db.syncQueue.bulkDelete(keys);
    await updateOfflineBadge();
};

// ─── setDoc (Optimistic-first) ────────────────────────────────────────────────
export const setDoc = async (docRef, data, { silent = false } = {}) => {
    const { collectionName, id } = docRef;
    const payload = { ...data, id };
    const table = tableFor(collectionName);

    // ① IndexedDB immediately
    if (table) await table.put(payload);

    // ② Enqueue (retryCount starts at 0)
    await db.syncQueue.add({
        collection: collectionName,
        docId: id,
        op: 'POST',
        data: payload,
        createdAt: Date.now(),
        retryCount: 0,
    });
    await updateOfflineBadge();

    // ③ Non-blocking background push
    const endpoint = toEndpoint(collectionName);
    fetchWithTimeout(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(async (res) => {
        if (res.ok || res.status === 201) {
            await clearFromQueue(collectionName, id);
            if (!silent) showToast('✓ Saved!', 'success');
        } else if (res.status === 409 || res.status === 400) {
            fetchWithTimeout(`${BASE_URL}/${endpoint}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).then(async (r2) => {
                if (r2.ok) {
                    await clearFromQueue(collectionName, id);
                    if (!silent) showToast('✓ Saved!', 'success');
                }
            }).catch(() => { });
        }
    }).catch(() => {
        if (!silent) showToast('📵 Saved offline — will sync later', 'warning');
    });
};

// ─── updateDoc ────────────────────────────────────────────────────────────────
export const updateDoc = async (docRef, data) => {
    const { collectionName, id } = docRef;
    const table = tableFor(collectionName);
    if (table) {
        const existing = (await table.get(id)) || {};
        await table.put({ ...existing, ...data, id });
    }
    fetchWithTimeout(`${BASE_URL}/${toEndpoint(collectionName)}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }).catch(() => {
        db.syncQueue.add({
            collection: collectionName, docId: id,
            op: 'PUT', data, createdAt: Date.now(), retryCount: 0,
        }).then(updateOfflineBadge);
    });
};

// ─── deleteDoc ────────────────────────────────────────────────────────────────
export const deleteDoc = async (docRef) => {
    const { collectionName, id } = docRef;
    const table = tableFor(collectionName);
    if (table) await table.delete(id);
    fetchWithTimeout(`${BASE_URL}/${toEndpoint(collectionName)}/${id}`, { method: 'DELETE' })
        .catch(() => {
            db.syncQueue.add({
                collection: collectionName, docId: id,
                op: 'DELETE', data: null, createdAt: Date.now(), retryCount: 0,
            }).then(updateOfflineBadge);
        });
};
