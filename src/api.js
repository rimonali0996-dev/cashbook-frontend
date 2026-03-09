// A compatibility layer to replace firebase/firestore using our MongoDB Express API
// Uses localStorage as primary cache, syncs with the API in the background.

const BASE_URL = 'https://cashbook-api-59vg.onrender.com/api';
const FETCH_TIMEOUT_MS = 8000; // 8 second max wait per request

// ─── Global Toast Notification System ────────────────────────────────────────
let _toastContainer = null;
const getToastContainer = () => {
    if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'api-toast-container';
        Object.assign(_toastContainer.style, {
            position: 'fixed', bottom: '80px', left: '50%',
            transform: 'translateX(-50%)', zIndex: '99999',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
            pointerEvents: 'none'
        });
        document.body.appendChild(_toastContainer);
    }
    return _toastContainer;
};

export const showToast = (message, type = 'success') => {
    const container = getToastContainer();
    const toast = document.createElement('div');
    const colors = {
        success: 'background:#22c55e;color:#fff',
        error: 'background:#ef4444;color:#fff',
        info: 'background:#3b82f6;color:#fff',
        warning: 'background:#f59e0b;color:#fff',
    };
    toast.setAttribute('style', `
        padding:10px 20px; border-radius:12px; font-size:14px; font-weight:600;
        box-shadow:0 4px 20px rgba(0,0,0,0.3); max-width:280px; text-align:center;
        opacity:0; transform:translateY(10px);
        transition: opacity 0.3s, transform 0.3s;
        pointer-events:none; ${colors[type] || colors.info}
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
// ─────────────────────────────────────────────────────────────────────────────

// Helper: fetch with a timeout so we never freeze the UI
const fetchWithTimeout = (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timer));
};

const collectionMap = {
    stockTransactions: 'stock-transactions',
    dueMessages: 'due-messages'
};
const toEndpoint = (name) => collectionMap[name] || name;

export const doc = (db, collectionName, id) => ({ collectionName, id });
export const collection = (db, collectionName) => ({ collectionName });
export const query = (colObj, whereObj) => ({ ...colObj, ...whereObj });
export const where = (field, op, val) => {
    if (field === 'businessId' && op === '==') return { businessId: val };
    return {};
};

// onSnapshot: call callback immediately from localStorage, then sync with API
export const onSnapshot = (queryObj, callback) => {
    const endpoint = toEndpoint(queryObj.collectionName);
    let url = `${BASE_URL}/${endpoint}`;
    if (queryObj.businessId) url += `/${queryObj.businessId}`;

    const makeSnapshot = (data) => ({
        docs: data.map(item => ({ id: item.id, data: () => item }))
    });

    // Immediately serve from localStorage cache
    const cacheKey = `api_cache_${url}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try { callback(makeSnapshot(JSON.parse(cached))); } catch (e) { }
    }

    // Then fetch from API and update
    const fetchData = async () => {
        try {
            const res = await fetchWithTimeout(url);
            if (!res.ok) return;
            const raw = await res.json();
            // Handle paginated response { data: [], total, page, pages }
            // as well as plain array responses from non-paginated endpoints
            const data = Array.isArray(raw) ? raw : (raw.data || []);
            localStorage.setItem(cacheKey, JSON.stringify(data));
            callback(makeSnapshot(data));
        } catch (err) {
            // Timeout or network error — silently use cached data
        }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Poll every 10s
    return () => clearInterval(interval);
};

export const getDoc = async (docRef) => {
    const endpoint = toEndpoint(docRef.collectionName);
    // Fast path: check localStorage first
    const cacheKey = `api_cache_${BASE_URL}/${endpoint}/${docRef.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const data = JSON.parse(cached);
            return { exists: () => true, data: () => data };
        } catch (e) { }
    }
    // Slow path: network
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/${endpoint}/${docRef.id}`);
        if (!res.ok) return { exists: () => false, data: () => null };
        const data = await res.json();
        localStorage.setItem(cacheKey, JSON.stringify(data));
        return { exists: () => true, data: () => data };
    } catch (err) {
        return { exists: () => false, data: () => null };
    }
};

// ─── setDoc: Optimistic-first save ───────────────────────────────────────────
// 1. Updates localStorage instantly (UI feels immediate)
// 2. Sends to API in background — if it fails, shows toast & rolls back cache
export const setDoc = async (docRef, data, { silent = false } = {}) => {
    const endpoint = toEndpoint(docRef.collectionName);
    const payload = { ...data, id: docRef.id };

    // ① Update localStorage immediately (instant UI update)
    const cacheKey = `api_cache_${BASE_URL}/${endpoint}/${docRef.id}`;
    const listCacheKey = `api_cache_${BASE_URL}/${endpoint}`;
    const prevItem = localStorage.getItem(cacheKey);

    localStorage.setItem(cacheKey, JSON.stringify(payload));
    const listBefore = localStorage.getItem(listCacheKey);
    try {
        const listCached = JSON.parse(listBefore || '[]');
        const idx = listCached.findIndex(i => i.id === docRef.id);
        if (idx >= 0) listCached[idx] = payload; else listCached.unshift(payload);
        localStorage.setItem(listCacheKey, JSON.stringify(listCached));
    } catch (e) { }

    // ② POST to API in background (non-blocking)
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok || res.status === 201) {
            if (!silent) showToast('✓ Saved!', 'success');
            return;
        }
        if (res.status === 409 || res.status === 400) {
            // Conflict: doc exists — try PUT instead
            const putRes = await fetchWithTimeout(`${BASE_URL}/${endpoint}/${docRef.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (putRes.ok) {
                if (!silent) showToast('✓ Saved!', 'success');
                return;
            }
        }
        throw new Error(`HTTP ${res.status}`);
    } catch (e) {
        // Rollback cache on permanent failure
        if (prevItem) localStorage.setItem(cacheKey, prevItem);
        else localStorage.removeItem(cacheKey);
        try {
            const listCached = JSON.parse(listBefore || '[]');
            localStorage.setItem(listCacheKey, JSON.stringify(listCached));
        } catch (_) { }
        if (!silent) showToast('⚠ Save failed — check connection', 'error');
        console.warn('setDoc: API sync failed:', e.message);
    }
};

export const updateDoc = async (docRef, data) => {
    const endpoint = toEndpoint(docRef.collectionName);
    // Update local cache immediately
    const cacheKey = `api_cache_${BASE_URL}/${endpoint}/${docRef.id}`;
    try {
        const existing = JSON.parse(localStorage.getItem(cacheKey) || '{}');
        const updated = { ...existing, ...data };
        localStorage.setItem(cacheKey, JSON.stringify(updated));
    } catch (e) { }
    // Background API sync
    try {
        await fetchWithTimeout(`${BASE_URL}/${endpoint}/${docRef.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (e) { }
};

export const deleteDoc = async (docRef) => {
    const endpoint = toEndpoint(docRef.collectionName);
    // Remove from local cache immediately
    localStorage.removeItem(`api_cache_${BASE_URL}/${endpoint}/${docRef.id}`);
    const listCacheKey = `api_cache_${BASE_URL}/${endpoint}`;
    try {
        const listCached = JSON.parse(localStorage.getItem(listCacheKey) || '[]');
        localStorage.setItem(listCacheKey, JSON.stringify(listCached.filter(i => i.id !== docRef.id)));
    } catch (e) { }
    // Background API sync
    try {
        await fetchWithTimeout(`${BASE_URL}/${endpoint}/${docRef.id}`, { method: 'DELETE' });
    } catch (e) { }
};
