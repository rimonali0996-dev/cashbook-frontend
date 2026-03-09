/**
 * CashbookDB — Dexie (IndexedDB) schema
 * Replaces localStorage so data survives browser-tab close,
 * supports unlimited storage, and enables offline-first reads.
 */
import Dexie from 'dexie';

export const db = new Dexie('CashbookDB');

// v1 — initial schema
db.version(1).stores({
    businesses: '&id',
    cashbooks: '&id, businessId',
    transactions: '&id, businessId, cashbookId, createdAt',
    inventory: '&id, businessId',
    dueMessages: '&id, businessId, createdAt',
    stockTransactions: '&id, businessId, productId, createdAt',

    // Pending writes queue — operations that haven't reached the server yet
    // op: 'POST' | 'PUT' | 'DELETE'
    syncQueue: '++queueId, collection, op, createdAt',
});

// v2 — add compound index [collection+docId] so we can efficiently
//       find/delete a specific doc's pending queue entries
db.version(2).stores({
    syncQueue: '++queueId, collection, op, createdAt, [collection+docId]',
});

export default db;
