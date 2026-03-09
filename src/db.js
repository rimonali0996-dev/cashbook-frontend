/**
 * CashbookDB — Dexie (IndexedDB) schema
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
    syncQueue: '++queueId, collection, op, createdAt',
});

// v2 — compound index [collection+docId]
db.version(2).stores({
    syncQueue: '++queueId, collection, op, createdAt, [collection+docId]',
});

// v3 — retryCount index so we can skip permanently-failing items
db.version(3).stores({
    syncQueue: '++queueId, collection, op, createdAt, retryCount, [collection+docId]',
});

export default db;
