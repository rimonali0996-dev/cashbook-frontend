/**
 * CashbookDB — Dexie (IndexedDB) schema
 * Replaces localStorage so data survives browser-tab close,
 * supports unlimited storage, and enables offline-first reads.
 */
import Dexie from 'dexie';

export const db = new Dexie('CashbookDB');

db.version(1).stores({
    // Each store: primary key first (&id = unique), then indexed fields
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

export default db;
