// A compatibility layer to replace firebase/firestore using our MongoDB Express API
// Uses localStorage as primary cache, syncs with the API in the background.

const BASE_URL = 'https://cashbook-api-59vg.onrender.com/api';
const FETCH_TIMEOUT_MS = 5000; // 5 second max wait per request

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
    const interval = setInterval(fetchData, 10000); // Poll every 10s (not 3s)
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

export const setDoc = async (docRef, data) => {
    const endpoint = toEndpoint(docRef.collectionName);
    const payload = { ...data, id: docRef.id };

    // ✅ Step 1: Update localStorage immediately (instant UI update)
    const cacheKey = `api_cache_${BASE_URL}/${endpoint}/${docRef.id}`;
    localStorage.setItem(cacheKey, JSON.stringify(payload));
    // Also push into list cache
    const listCacheKey = `api_cache_${BASE_URL}/${endpoint}`;
    try {
        const listCached = JSON.parse(localStorage.getItem(listCacheKey) || '[]');
        const idx = listCached.findIndex(i => i.id === docRef.id);
        if (idx >= 0) listCached[idx] = payload; else listCached.push(payload);
        localStorage.setItem(listCacheKey, JSON.stringify(listCached));
    } catch (e) { }

    // ✅ Step 2: POST to API in background (no blocking GET check)
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.status === 409 || res.status === 400) {
            // Conflict: doc exists — try PUT instead
            fetchWithTimeout(`${BASE_URL}/${endpoint}/${docRef.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(() => { });
        }
    } catch (e) {
        // API offline/slow — localStorage already saved, data is safe
        console.warn('setDoc: API sync failed (data saved locally):', e.message);
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
