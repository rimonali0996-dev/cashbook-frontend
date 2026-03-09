const fs = require('fs');
const code = fs.readFileSync('./src/App.jsx', 'utf-8');

let newCode = code;

// 1. Setup Auth Listener
const authEffect = `
  useEffect(() => {
    signInAnonymously(auth).catch((error) => console.error("Firebase Auth Error:", error));
  }, []);
`;
newCode = newCode.replace(/function App\(\) \{/, 'function App() {' + authEffect);

// 2. Replace Load Effects
const oldLoadEffect = `  // Load data when business changes
  useEffect(() => {
    if (activeBusinessId) {
      setCashbooks(JSON.parse(localStorage.getItem(getStorageKey('cashbooks')) || '[]'));
      setTransactions(JSON.parse(localStorage.getItem(getStorageKey('transactions')) || '[]'));
      setInventory(JSON.parse(localStorage.getItem(getStorageKey('inventory')) || '[]'));
      setStockTransactions(JSON.parse(localStorage.getItem(getStorageKey('stockTransactions')) || '[]'));

      const savedAttempts = localStorage.getItem(getStorageKey('loginFailedAttempts'));
      setLoginFailedAttempts(savedAttempts ? parseInt(savedAttempts, 10) : 0);

      const savedLockout = localStorage.getItem(getStorageKey('loginLockoutUntil'));
      setLoginLockoutUntil(savedLockout ? parseInt(savedLockout, 10) : null);
    }
  }, [activeBusinessId]);`;

const newLoadEffect = `  // Load data when business changes via Firebase onSnapshot
  useEffect(() => {
    if (!activeBusinessId) return;

    const savedAttempts = localStorage.getItem(getStorageKey('loginFailedAttempts'));
    setLoginFailedAttempts(savedAttempts ? parseInt(savedAttempts, 10) : 0);

    const savedLockout = localStorage.getItem(getStorageKey('loginLockoutUntil'));
    setLoginLockoutUntil(savedLockout ? parseInt(savedLockout, 10) : null);

    const unsubCashbooks = onSnapshot(query(collection(db, 'cashbooks'), where('businessId', '==', activeBusinessId)), snap => {
      setCashbooks(snap.docs.map(doc => doc.data()));
    });
    const unsubTxns = onSnapshot(query(collection(db, 'transactions'), where('businessId', '==', activeBusinessId)), snap => {
      setTransactions(snap.docs.map(doc => doc.data()).sort((a,b) => b.id - a.id));
    });
    const unsubInv = onSnapshot(query(collection(db, 'inventory'), where('businessId', '==', activeBusinessId)), snap => {
      setInventory(snap.docs.map(doc => doc.data()).sort((a,b) => b.id - a.id));
    });
    const unsubStock = onSnapshot(query(collection(db, 'stockTransactions'), where('businessId', '==', activeBusinessId)), snap => {
      setStockTransactions(snap.docs.map(doc => doc.data()).sort((a,b) => b.id - a.id));
    });

    return () => {
      unsubCashbooks(); unsubTxns(); unsubInv(); unsubStock();
    };
  }, [activeBusinessId]);`;
newCode = newCode.replace(oldLoadEffect, newLoadEffect);

// 3. Remove Persistence Effects
const oldPersistence = `  // --- Persistence ---
  useEffect(() => {
    if (activeBusinessId) localStorage.setItem(getStorageKey('cashbooks'), JSON.stringify(cashbooks));
  }, [cashbooks]);

  useEffect(() => {
    if (activeBusinessId) localStorage.setItem(getStorageKey('transactions'), JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    if (activeBusinessId) localStorage.setItem(getStorageKey('inventory'), JSON.stringify(inventory));
  }, [inventory]);

  useEffect(() => {
    if (activeBusinessId) localStorage.setItem(getStorageKey('stockTransactions'), JSON.stringify(stockTransactions));
  }, [stockTransactions]);`;
newCode = newCode.replace(oldPersistence, '// --- Persistence handled by Firebase ---');

fs.writeFileSync('./src/App.jsx', newCode);
console.log('Script Phase 1 done');
