import React, { useState, useEffect, useRef } from 'react';
import { IndianRupee, User, FileText, Tag, Wallet, CreditCard, ArrowRightLeft, Plus, ArrowLeft, Home as HomeIcon, FileClock, Book, BookOpen, Download, PackageOpen, LayoutGrid, Lock, Unlock, Edit2, Trash2, Check, Settings, Upload, Database } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { useTranslation } from 'react-i18next';
import './i18n/config'; // Import i18n setup
import { fontBase64 } from './fonts/NotoSansBengali-Regular';

// --- Firebase & Image Compression ---
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, getDoc, query, where, showToast } from './api';
const db = {}; // api.js handles routing — db is a placeholder
import imageCompression from 'browser-image-compression';

const CurrencyIcon = ({ className }) => {
  const { i18n } = useTranslation();
  if (i18n.language === 'bn') return <span className={`font-bold ${className || ''}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>৳</span>;
  if (i18n.language === 'hi') return <span className={`font-bold ${className || ''}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>₹</span>;
  if (i18n.language === 'ur') return <span className={`font-bold ${className || ''}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Rs</span>;
  return <IndianRupee className={className} />;
};

function App() {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [appTheme, setAppTheme] = useState(() => localStorage.getItem('appTheme') || 'neon');
  const [isSaving, setIsSaving] = useState(false); // button loading state

  useEffect(() => {
    if (appTheme && appTheme !== 'neon') {
      document.body.setAttribute('data-theme', appTheme);
    } else {
      document.body.removeAttribute('data-theme');
    }
  }, [appTheme]);

  const handleExportData = async () => {
    try {
      const backupData = {
        cashbooks: localStorage.getItem('cashbooks'),
        transactions: localStorage.getItem('transactions'),
        inventory: localStorage.getItem('inventory'),
        stockTransactions: localStorage.getItem('stockTransactions'),
        appLanguage: localStorage.getItem('appLanguage'),
        appTheme: localStorage.getItem('appTheme')
      };
      const jsonString = JSON.stringify(backupData, null, 2);
      const fileName = `Cashbook_Backup_${new Date().toLocaleDateString().replace(/\//g, '-')}.json`;

      const blob = new Blob([jsonString], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Export Error:", err);
    }
  };

  const handleImportData = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!window.confirm(t('confirmImport'))) {
      event.target.value = ''; // reset
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.cashbooks || data.transactions || data.inventory) {
          if (data.cashbooks) localStorage.setItem('cashbooks', data.cashbooks);
          if (data.transactions) localStorage.setItem('transactions', data.transactions);
          if (data.inventory) localStorage.setItem('inventory', data.inventory);
          if (data.stockTransactions) localStorage.setItem('stockTransactions', data.stockTransactions);
          if (data.appLanguage) {
            localStorage.setItem('appLanguage', data.appLanguage);
            i18n.changeLanguage(data.appLanguage);
          }
          if (data.appTheme) {
            localStorage.setItem('appTheme', data.appTheme);
            setAppTheme(data.appTheme);
          }

          alert(t('importSuccess'));
          window.location.reload();
        } else {
          alert(t('importError') + " (No valid data found)");
        }
      } catch (err) {
        alert(t('importError') + " Error: " + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // reset
  };

  const [businesses, setBusinesses] = useState(() => {
    const saved = localStorage.getItem('businesses');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeBusinessId, setActiveBusinessId] = useState(() => localStorage.getItem('activeBusinessId') || null);
  const [currentUserRole, setCurrentUserRole] = useState(null); // null, 'admin', 'manager', 'salesman', 'collector'

  const [currentView, setCurrentView] = useState(() => {
    const savedLang = localStorage.getItem('appLanguage');
    if (!savedLang) return 'languageSelection';
    const savedBiz = localStorage.getItem('activeBusinessId');
    if (!savedBiz) return 'businessSelection';
    return 'login'; // Must login per session
  });

  const getStorageKey = (key) => activeBusinessId ? `${key}_${activeBusinessId}` : key;

  const [cashbooks, setCashbooks] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [stockTransactions, setStockTransactions] = useState([]);
  const [dueMessages, setDueMessages] = useState([]);
  const [activeCashbookId, setActiveCashbookId] = useState(null);
  const [dashboardTab, setDashboardTab] = useState('wallet');

  // --- Firebase Real-time Listeners ---
  useEffect(() => {
    if (!activeBusinessId) return;

    // Load Local Lockout States
    const savedAttempts = localStorage.getItem(getStorageKey('loginFailedAttempts'));
    setLoginFailedAttempts(savedAttempts ? parseInt(savedAttempts, 10) : 0);
    const savedLockout = localStorage.getItem(getStorageKey('loginLockoutUntil'));
    setLoginLockoutUntil(savedLockout ? parseInt(savedLockout, 10) : null);

    // Subscribe to Firestore collections
    const unsubCashbooks = onSnapshot(query(collection(db, 'cashbooks'), where('businessId', '==', activeBusinessId)), snap => {
      setCashbooks(snap.docs.map(doc => doc.data()));
    });
    const unsubTxns = onSnapshot(query(collection(db, 'transactions'), where('businessId', '==', activeBusinessId)), snap => {
      setTransactions(snap.docs.map(doc => doc.data()).sort((a, b) => b.id - a.id));
    });
    const unsubInv = onSnapshot(query(collection(db, 'inventory'), where('businessId', '==', activeBusinessId)), snap => {
      setInventory(snap.docs.map(doc => doc.data()).sort((a, b) => b.id - a.id));
    });
    const unsubStock = onSnapshot(query(collection(db, 'stockTransactions'), where('businessId', '==', activeBusinessId)), snap => {
      setStockTransactions(snap.docs.map(doc => doc.data()).sort((a, b) => b.id - a.id));
    });
    const unsubDue = onSnapshot(query(collection(db, 'dueMessages'), where('businessId', '==', activeBusinessId)), snap => {
      setDueMessages(snap.docs.map(doc => doc.data()).sort((a, b) => b.id - a.id));
    });

    return () => {
      unsubCashbooks(); unsubTxns(); unsubInv(); unsubStock(); unsubDue();
    };
  }, [activeBusinessId]);

  useEffect(() => {
    localStorage.setItem('businesses', JSON.stringify(businesses));
  }, [businesses]);

  useEffect(() => {
    if (activeBusinessId) {
      localStorage.setItem('activeBusinessId', activeBusinessId);
    } else {
      localStorage.removeItem('activeBusinessId');
    }
  }, [activeBusinessId]);

  // --- Authentication & Business Logics ---
  const [newBusinessName, setNewBusinessName] = useState('');
  const [joinBusinessId, setJoinBusinessId] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginRole, setLoginRole] = useState('admin');
  const [managePins, setManagePins] = useState({
    admin: '1234', manager: '0000', salesman: '0000', collector: '0000'
  });

  const handlePinChange = async (role, newPin) => {
    // Only allow max 4 digits
    if (newPin.length > 4) return;
    const newPins = { ...managePins, [role]: newPin };
    setManagePins(newPins);
    try {
      await updateDoc(doc(db, 'businesses', activeBusinessId), { pins: newPins });
    } catch (err) {
      console.error(err);
    }
  };

  // Sync pins when settings is opened
  useEffect(() => {
    if (activeBusinessId && currentUserRole === 'admin') {
      getDoc(doc(db, 'businesses', activeBusinessId)).then(snap => {
        if (snap.exists() && snap.data().pins) {
          setManagePins(snap.data().pins);
        }
      }).catch(err => console.error("Error fetching pins", err));
    }
  }, [activeBusinessId, currentUserRole]);

  const handleAddBusiness = async (e) => {
    e.preventDefault();
    console.log("handleAddBusiness trigger fired! Name:", newBusinessName);
    if (!newBusinessName.trim()) return;
    const bizId = Date.now().toString();
    const newBiz = { id: bizId, name: newBusinessName.trim() };

    // Save to Firestore
    const defaultPins = { admin: '1234', manager: '0000', salesman: '0000', collector: '0000' };
    try {
      await setDoc(doc(db, 'businesses', bizId), {
        ...newBiz,
        pins: defaultPins
      });
      setBusinesses([...businesses, newBiz]);
      setNewBusinessName('');
      setActiveBusinessId(newBiz.id);
      setCurrentView('login');
    } catch (err) {
      console.error(err);
      alert("Error creating company. Please check your Firebase Database Rules.\n" + err.message);
    }
  };

  const handleJoinBusiness = async (e) => {
    e.preventDefault();
    if (!joinBusinessId.trim()) return;

    try {
      const docSnap = await getDoc(doc(db, 'businesses', joinBusinessId.trim()));
      if (docSnap.exists()) {
        const bizData = docSnap.data();
        const newBiz = { id: bizData.id, name: bizData.name };

        // Prevent duplicate local entries
        if (!businesses.find(b => b.id === newBiz.id)) {
          setBusinesses([...businesses, newBiz]);
        }

        setJoinBusinessId('');
        setActiveBusinessId(newBiz.id);
        setCurrentView('login');
      } else {
        alert("Company not found with this ID.");
      }
    } catch (err) {
      console.error(err);
      alert("Error joining company. Please check your Firebase Database Rules.\n\n" + err.message);
    }
  };

  const handleSelectBusiness = (id) => {
    setActiveBusinessId(id);
    setCurrentView('login');
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    // Check lockout
    if (loginLockoutUntil && Date.now() < loginLockoutUntil) {
      const remainingMin = Math.ceil((loginLockoutUntil - Date.now()) / 60000);
      alert(t('loginLockout', { minutes: remainingMin }));
      return;
    }

    // Fast path: check localStorage first (instant, no network call)
    let pins = { admin: '1234', manager: '0000', salesman: '0000', collector: '0000' };
    const localBusinesses = JSON.parse(localStorage.getItem('businesses') || '[]');
    const localBiz = localBusinesses.find(b => b.id === activeBusinessId);
    if (localBiz && localBiz.pins) {
      pins = localBiz.pins;
    } else {
      // Slow path: fetch from server only if not cached locally
      try {
        const docSnap = await getDoc(doc(db, 'businesses', activeBusinessId));
        if (docSnap.exists() && docSnap.data().pins) {
          pins = docSnap.data().pins;
        }
      } catch (err) {
        console.warn('API PIN lookup failed, using default pins:', err.message);
      }
    }

    if (loginPin === pins[loginRole]) {
      setLoginFailedAttempts(0);
      setLoginLockoutUntil(null);
      setCurrentUserRole(loginRole);
      setLoginPin('');
      setCurrentView('home');
    } else {
      const newAttempts = loginFailedAttempts + 1;
      setLoginFailedAttempts(newAttempts);

      if (newAttempts >= 3) {
        const lockoutTime = Date.now() + (5 * 60 * 1000); // 5 minutes
        setLoginLockoutUntil(lockoutTime);
        alert(t('incorrectPinLockout'));
      } else {
        alert(t('incorrectPinRemaining', { attempts: 3 - newAttempts }));
      }
    }
  };

  const handleLogout = () => {
    setCurrentUserRole(null);
    setActiveBusinessId(null);
    setCurrentView('businessSelection');
  };

  const [loginFailedAttempts, setLoginFailedAttempts] = useState(() => {
    const saved = localStorage.getItem(getStorageKey('loginFailedAttempts'));
    return saved ? parseInt(saved, 10) : 0;
  });
  const [loginLockoutUntil, setLoginLockoutUntil] = useState(() => {
    const saved = localStorage.getItem(getStorageKey('loginLockoutUntil'));
    return saved ? parseInt(saved, 10) : null;
  });

  useEffect(() => {
    if (activeBusinessId) {
      localStorage.setItem(getStorageKey('loginFailedAttempts'), loginFailedAttempts.toString());
    }
  }, [loginFailedAttempts]);

  useEffect(() => {
    if (activeBusinessId) {
      if (loginLockoutUntil) {
        localStorage.setItem(getStorageKey('loginLockoutUntil'), loginLockoutUntil.toString());
      } else {
        localStorage.removeItem(getStorageKey('loginLockoutUntil'));
      }
    }
  }, [loginLockoutUntil]);

  const [newCashbook, setNewCashbook] = useState({
    name: '',
    openingBalance: ''
  });

  const [formData, setFormData] = useState({
    amount: '',
    partyName: '',
    remark: '',
    category: '',
    paymentMode: 'Cash',
    type: 'IN', // 'IN' or 'OUT'
    isInventoryLinked: false,
    selectedProductId: '',
    inventoryQuantity: ''
  });

  // --- Handlers for Inventory ---
  const [newProduct, setNewProduct] = useState({ name: '', quantity: '', price: '' });
  // Old handleToggleAdmin replaced by Login system

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.quantity || !newProduct.price || !activeBusinessId) return;

    const qty = parseInt(newProduct.quantity, 10);
    const price = parseFloat(newProduct.price);

    if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
      alert("Please enter valid quantity and price.");
      return;
    }

    const totalExpense = qty * price;
    const prodId = Date.now().toString();

    const prod = {
      id: prodId,
      businessId: activeBusinessId,
      cashbookId: activeCashbookId,
      name: newProduct.name,
      stockCount: qty,
      totalExpense: totalExpense,
      totalRevenue: 0
    };

    // Image Compression for Product Photo (Base64)
    if (newProduct.imageFile) {
      try {
        const compressedFile = await imageCompression(newProduct.imageFile, {
          maxSizeMB: 0.1, // Max 100 KB
          maxWidthOrHeight: 600,
          useWebWorker: true
        });

        const base64data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(compressedFile);
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = error => reject(error);
        });

        prod.imageURL = base64data;
      } catch (err) {
        console.error("Product Image Compression Error:", err);
      }
    }

    await setDoc(doc(db, 'inventory', prodId), prod);

    const initialTxnId = (Date.now() + 1).toString();
    const initialTxn = {
      id: initialTxnId,
      businessId: activeBusinessId,
      cashbookId: activeCashbookId,
      productId: prodId,
      productName: newProduct.name,
      type: 'IN',
      count: qty,
      price: totalExpense,
      companyName: '-',
      paymentStatus: 'Paid',
      date: new Date().toLocaleDateString()
    };
    await setDoc(doc(db, 'stockTransactions', initialTxnId), initialTxn);

    // Create matching wallet transaction if there is an expense
    if (totalExpense > 0) {
      const walletTxnId = (Date.now() + 2).toString();
      const walletTxn = {
        id: walletTxnId,
        businessId: activeBusinessId,
        cashbookId: activeCashbookId,
        type: 'OUT',
        amount: totalExpense,
        partyName: 'Supplier (Initial Stock)',
        category: 'Inventory',
        remark: `Initial Stock: ${qty}x ${newProduct.name}`,
        paymentMode: 'Cash',
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        isLinkedToInventory: true,
        linkedProductId: prodId,
        linkedQuantity: qty
      };
      await setDoc(doc(db, 'transactions', walletTxnId), walletTxn);
    }

    setNewProduct({ name: '', quantity: '', price: '', imageFile: null });
  };

  const [activeStockProduct, setActiveStockProduct] = useState(null); // { id, name, type: 'IN' | 'OUT' }
  const [stockForm, setStockForm] = useState({
    count: '',
    price: '',
    companyName: '',
    paymentStatus: 'Paid' // 'Paid' or 'Due'
  });

  const openStockForm = (product, type) => {
    setActiveStockProduct({ ...product, type });
    setStockForm({ count: '', price: '', companyName: '', paymentStatus: 'Paid' });
  };

  const handleStockFormChange = (e) => {
    const { name, value } = e.target;
    setStockForm(prev => ({ ...prev, [name]: value }));
  };

  const submitStockTransaction = async (e) => {
    e.preventDefault();
    if (!activeStockProduct || !stockForm.count || isNaN(stockForm.count) || !activeBusinessId) return;

    const qty = parseInt(stockForm.count, 10);
    const price = parseFloat(stockForm.price) || 0;

    if (qty <= 0) {
      alert("Please enter a valid positive count.");
      return;
    }

    const stockTxnId = Date.now().toString();
    const newTxn = {
      id: stockTxnId,
      businessId: activeBusinessId,
      cashbookId: activeCashbookId,
      productId: activeStockProduct.id,
      productName: activeStockProduct.name,
      type: activeStockProduct.type,
      count: qty,
      price: price,
      companyName: stockForm.companyName || '-',
      paymentStatus: stockForm.paymentStatus,
      date: new Date().toLocaleDateString()
    };

    let newStockCount = activeStockProduct.stockCount;
    let newTotalExpense = activeStockProduct.totalExpense;
    let newTotalRevenue = activeStockProduct.totalRevenue || 0;

    // Financials update logic for the Product
    if (activeStockProduct.type === 'IN') {
      newStockCount += qty;
      newTotalExpense += price;
    } else {
      newStockCount = Math.max(0, newStockCount - qty);
      newTotalRevenue += price;
    }

    await setDoc(doc(db, 'stockTransactions', stockTxnId), newTxn);
    await updateDoc(doc(db, 'inventory', activeStockProduct.id.toString()), {
      stockCount: newStockCount,
      totalExpense: newTotalExpense,
      totalRevenue: newTotalRevenue
    });

    const walletTxnType = activeStockProduct.type === 'IN' ? 'OUT' : 'IN';
    const walletTxnId = (Date.now() + 1).toString();

    if (price > 0 && stockForm.paymentStatus === 'Paid') {
      const walletTxn = {
        id: walletTxnId,
        businessId: activeBusinessId,
        cashbookId: activeCashbookId,
        type: walletTxnType,
        amount: price,
        partyName: stockForm.companyName || 'Retail Customer',
        category: 'Inventory',
        remark: `Stock ${activeStockProduct.type}: ${qty}x ${activeStockProduct.name}`,
        paymentMode: 'Cash',
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        isLinkedToInventory: true,
        linkedProductId: activeStockProduct.id,
        linkedQuantity: qty
      };
      await setDoc(doc(db, 'transactions', walletTxnId), walletTxn);
    }

    setActiveStockProduct(null); // close modal
  };

  const markStockAsPaid = async (id) => {
    try {
      await updateDoc(doc(db, 'stockTransactions', id.toString()), { paymentStatus: 'Paid' });
    } catch (e) { console.error(e); }
  };

  const deleteStockTransaction = async (id) => {
    if (currentUserRole !== 'admin') {
      alert("Admin permission required to delete a stock record.");
      return;
    }
    if (window.confirm("Are you sure you want to delete this stock record? This will NOT automatically adjust your current inventory count.")) {
      try {
        await deleteDoc(doc(db, 'stockTransactions', id.toString()));
      } catch (e) { console.error(e); }
    }
  };

  const adminEditProduct = async (id) => {
    if (currentUserRole !== 'admin') return;
    const p = inventory.find(x => x.id.toString() === id.toString());
    if (!p) return;

    const newStockStr = prompt(`Edit absolute stock for ${p.name}:`, p.stockCount);
    if (newStockStr !== null) {
      const newStock = parseInt(newStockStr, 10);
      if (!isNaN(newStock) && newStock >= 0) {
        try {
          await updateDoc(doc(db, 'inventory', id.toString()), { stockCount: newStock });
        } catch (e) { console.error(e); }
      }
    }
  };

  const deleteProduct = async (id) => {
    if (currentUserRole !== 'admin') {
      alert("Admin permission required to delete a product.");
      return;
    }
    if (window.confirm("Are you sure you want to delete this product?")) {
      try {
        await deleteDoc(doc(db, 'inventory', id.toString()));
      } catch (e) { console.error(e); }
    }
  };


  // --- Handlers for Cashbook ---

  const handleNewCashbookChange = (e) => {
    const { name, value } = e.target;
    setNewCashbook(prev => ({ ...prev, [name]: value }));
  };

  const handleCreateCashbook = async (e) => {
    e.preventDefault();
    if (!newCashbook.name || !activeBusinessId) return;

    const cbId = Date.now().toString();
    const newCb = {
      id: cbId,
      businessId: activeBusinessId,
      name: newCashbook.name,
      openingBalance: parseFloat(newCashbook.openingBalance) || 0,
      createdAt: new Date().toLocaleDateString()
    };

    await setDoc(doc(db, 'cashbooks', cbId), newCb);

    setActiveCashbookId(newCb.id);
    setDashboardTab('wallet');
    setNewCashbook({ name: '', openingBalance: '' });
    setCurrentView('dashboard');
  };

  const openCashbook = (id) => {
    setActiveCashbookId(id);
    setDashboardTab('wallet');
    setCurrentView('dashboard');
  };

  // --- Handlers for Transactions ---

  const handleTransactionChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleAddDueMessage = async (e) => {
    e.preventDefault();
    if (!formData.clientName || !formData.dueAmount) return;

    const msgId = Date.now().toString();
    const newMsg = {
      id: msgId,
      businessId: activeBusinessId,
      clientName: formData.clientName,
      dueAmount: parseFloat(formData.dueAmount),
      phone: formData.phone || '',
      lastMessageSentAt: null
    };

    // ⚡ Optimistic: clear form and show success immediately
    setFormData({ ...formData, clientName: '', dueAmount: '', phone: '' });
    showToast('✓ Due recorded!', 'success');

    // Background save (non-blocking)
    setDoc(doc(db, 'dueMessages', msgId), newMsg, { silent: true }).catch(err => {
      console.error(err);
      showToast('⚠ Due save failed!', 'error');
    });
  };

  const handleSendDueMessage = async (msg) => {
    const amountStr = msg.dueAmount.toLocaleString('en-IN');
    const message = `Hello ${msg.clientName},\nThis is a gentle reminder that your due amount of ${amountStr} is pending. Please arrange the payment soon.\nThank you!`;
    const whatsappUrl = msg.phone ? `https://wa.me/${msg.phone}?text=${encodeURIComponent(message)}` : `whatsapp://send?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');

    try {
      await updateDoc(doc(db, 'dueMessages', msg.id), {
        lastMessageSentAt: new Date().toISOString()
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteDueMessage = async (id) => {
    if (window.confirm("Are you sure you want to delete this record?")) {
      await deleteDoc(doc(db, 'dueMessages', id));
    }
  };

  const handleTypeToggle = (type) => {
    setFormData(prev => ({ ...prev, type }));
  };

  const handleTransactionSubmit = async (e) => {
    e.preventDefault();
    if (!formData.amount || isNaN(formData.amount) || isSaving) return;

    setIsSaving(true);
    const txnId = Date.now().toString();
    const newTransaction = {
      ...formData,
      id: txnId,
      businessId: activeBusinessId,
      cashbookId: activeCashbookId,
      date: new Date().toLocaleDateString(),
      amount: parseFloat(formData.amount)
    };

    // Image Compression & Base64 Encode
    if (formData.imageFile) {
      try {
        const compressedFile = await imageCompression(formData.imageFile, {
          maxSizeMB: 0.1,
          maxWidthOrHeight: 800,
          useWebWorker: true
        });
        const base64data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(compressedFile);
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = error => reject(error);
        });
        newTransaction.imageURL = base64data;
      } catch (err) {
        console.error("Image Compression Failed:", err);
      }
    }
    delete newTransaction.imageFile;

    // ⚡ Optimistic: navigate away INSTANTLY, save in background
    setFormData({
      amount: '', partyName: '', remark: '', category: '',
      paymentMode: 'Cash', type: 'IN', isInventoryLinked: false,
      selectedProductId: '', inventoryQuantity: '', imageFile: null
    });
    setCurrentView('dashboard');
    setIsSaving(false);

    // Background saves (non-blocking)
    setDoc(doc(db, 'transactions', txnId), newTransaction, { silent: false });

    // Handle Inventory Linkage in background
    if (formData.isInventoryLinked && formData.selectedProductId && formData.inventoryQuantity) {
      const linkQty = parseInt(formData.inventoryQuantity, 10);
      const linkedProduct = inventory.find(p => p.id.toString() === formData.selectedProductId.toString());

      if (linkedProduct && !isNaN(linkQty) && linkQty > 0) {
        const isWalletIncome = formData.type === 'IN';
        const stockType = isWalletIncome ? 'OUT' : 'IN';
        const stockTxnId = (Date.now() + 1).toString();
        const newStockTxn = {
          id: stockTxnId,
          businessId: activeBusinessId,
          cashbookId: activeCashbookId,
          productId: linkedProduct.id,
          productName: linkedProduct.name,
          type: stockType,
          count: linkQty,
          price: parseFloat(formData.amount),
          companyName: formData.partyName || '-',
          paymentStatus: 'Paid',
          date: new Date().toLocaleDateString()
        };
        setDoc(doc(db, 'stockTransactions', stockTxnId), newStockTxn, { silent: true });

        let newStockCount = linkedProduct.stockCount;
        let newTotalExpense = linkedProduct.totalExpense;
        let newTotalRevenue = linkedProduct.totalRevenue || 0;
        if (stockType === 'IN') { newStockCount += linkQty; newTotalExpense += parseFloat(formData.amount); }
        else { newStockCount = Math.max(0, newStockCount - linkQty); newTotalRevenue += parseFloat(formData.amount); }
        updateDoc(doc(db, 'inventory', linkedProduct.id.toString()), {
          stockCount: newStockCount, totalExpense: newTotalExpense, totalRevenue: newTotalRevenue
        });
      }
    }
  };

  // --- Calculations ---

  const activeCashbook = cashbooks.find(cb => cb.id === activeCashbookId);
  const activeTransactions = transactions.filter(t => t.cashbookId === activeCashbookId);

  const openingBalance = activeCashbook ? activeCashbook.openingBalance : 0;
  const totalIn = activeTransactions.filter(t => t.type === 'IN').reduce((acc, curr) => acc + curr.amount, 0);
  const totalOut = activeTransactions.filter(t => t.type === 'OUT').reduce((acc, curr) => acc + curr.amount, 0);
  const netBalance = openingBalance + totalIn - totalOut;
  const totalFunds = openingBalance + totalIn;
  const totalVolume = totalFunds + totalOut;
  const inPercent = totalVolume === 0 ? 0 : (totalFunds / totalVolume) * 100;

  // Helper for Home Screen Balances
  const getCashbookBalance = (cbId) => {
    const cb = cashbooks.find(c => c.id === cbId);
    const cbTxns = transactions.filter(t => t.cashbookId === cbId);
    const tin = cbTxns.filter(t => t.type === 'IN').reduce((acc, curr) => acc + curr.amount, 0);
    const tout = cbTxns.filter(t => t.type === 'OUT').reduce((acc, curr) => acc + curr.amount, 0);
    return (cb ? cb.openingBalance : 0) + tin - tout;
  };

  // --- Inventory Dashboard Data ---
  const activeInventory = inventory.filter(p => p.cashbookId === activeCashbookId);
  const activeStockTransactions = stockTransactions.filter(t => t.cashbookId === activeCashbookId);

  const totalInventoryInvestment = activeInventory.reduce((acc, curr) => acc + curr.totalExpense, 0);
  const totalInventoryRevenue = activeInventory.reduce((acc, curr) => acc + (curr.totalRevenue || 0), 0);
  const totalInventoryProfit = totalInventoryRevenue - totalInventoryInvestment;

  // --- Export Functions ---

  const exportToPDF = async () => {
    if (!activeCashbook) return;

    const doc = new jsPDF();

    // Add Custom Unicode Font
    doc.addFileToVFS("NotoSansBengali.ttf", fontBase64);
    doc.addFont("NotoSansBengali.ttf", "NotoSansBengali", "normal");
    doc.setFont("NotoSansBengali");

    // Setup Header
    doc.setFontSize(20);
    doc.text(`${t('cashbookReport')}: ${activeCashbook.name}`, 14, 22);

    doc.setFontSize(12);
    doc.text(`${t('generatedOn')}: ${new Date().toLocaleDateString()}`, 14, 32);
    doc.text(`${t('opBal')}: ${openingBalance}`, 14, 40);
    doc.text(`${t('totalCashIn')}: +${totalIn}`, 14, 48);
    doc.text(`${t('totalCashOut')}: -${totalOut}`, 14, 56);
    doc.text(`${t('netBal')}: ${netBalance}`, 14, 64);

    // Setup Table Data
    const tableColumn = [t('date'), t('partyName'), t('category'), t('remark'), t('mode'), t('type'), t('amount')];
    const tableRows = [];

    activeTransactions.forEach(txn => {
      const transactionData = [
        txn.date,
        txn.partyName,
        txn.category,
        txn.remark || '-',
        txn.paymentMode,
        txn.type === 'IN' ? t('cashIn') : t('cashOut'),
        txn.amount.toString()
      ];
      tableRows.push(transactionData);
    });

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 72,
      theme: 'grid',
      styles: {
        font: "NotoSansBengali",
        fontSize: 10
      },
      headStyles: {
        fillColor: [37, 99, 235], // Tailwind blue-600
        fontStyle: 'normal',
        font: "NotoSansBengali"
      }
    });

    const fileName = `${activeCashbook.name.replace(/\s+/g, '_')}_Report.pdf`;

    try {
      // Get base64 string
      const pdfBase64 = doc.output('datauristring').split(',')[1];

      // Save to device
      const result = await Filesystem.writeFile({
        path: fileName,
        data: pdfBase64,
        directory: Directory.Documents,
      });

      // Share/Open
      await Share.share({
        title: t('sharePDFReport'),
        text: `${t('cashbookReport')} ${t('for')} ${activeCashbook.name}`,
        url: result.uri,
        dialogTitle: t('sharePDF')
      });
    } catch (e) {
      console.error("Error saving/sharing PDF:", e);
      // Fallback for web
      doc.save(fileName);
    }
  };

  const exportToExcel = async () => {
    if (!activeCashbook) return;

    // Excel takes an array of objects
    const dataForExcel = activeTransactions.map(txn => ({
      [t('date')]: txn.date,
      [t('partyName')]: txn.partyName,
      [t('category')]: txn.category,
      [t('type')]: txn.type === 'IN' ? t('cashIn') : t('cashOut'),
      [t('amount')]: txn.amount,
      [t('mode')]: txn.paymentMode,
      [t('remark')]: txn.remark || '-'
    }));

    // Add summary row at the end
    dataForExcel.push({
      [t('date')]: '',
      [t('partyName')]: 'SUMMARY',
      [t('category')]: '',
      [t('type')]: t('netBal') + ':',
      [t('amount')]: netBalance,
      [t('mode')]: '',
      [t('remark')]: `${t('includes')} ${t('opBal')}: ${openingBalance}`
    });

    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");

    // Auto adjust columns slightly
    worksheet['!cols'] = [
      { wch: 12 }, // Date
      { wch: 20 }, // Party Name
      { wch: 15 }, // Category
      { wch: 10 }, // Type
      { wch: 12 }, // Amount
      { wch: 10 }, // Mode
      { wch: 25 }, // Remark
    ];

    const fileName = `${activeCashbook.name.replace(/\s+/g, '_')}_Transactions.xlsx`;

    try {
      // Get base64 output
      const excelBase64 = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' });

      // Save to device
      const result = await Filesystem.writeFile({
        path: fileName,
        data: excelBase64,
        directory: Directory.Documents,
      });

      // Share/Open
      await Share.share({
        title: 'Share Excel Report',
        text: `Cashbook transactions for ${activeCashbook.name}`,
        url: result.uri,
        dialogTitle: 'Share Excel'
      });
    } catch (e) {
      console.error("Error saving/sharing Excel:", e);
      // Fallback for web
      XLSX.writeFile(workbook, fileName);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] py-8 px-4 sm:px-6 lg:px-8 font-sans text-gray-100">
      <div className="max-w-md mx-auto">

        {/* ================= LANGUAGE SELECTION VIEW ================= */}
        {currentView === 'languageSelection' && (
          <div className="space-y-6 animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[80vh]">
            <div className="glass-panel w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm mt-4 neon-border-cyan">
              <Book className="h-10 w-10 neon-text-cyan" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight neon-text-cyan text-center">{t('languageSetup')}</h1>
            <p className="text-gray-400 mt-2 text-sm text-center mb-8">{t('chooseLanguage')}</p>

            <div className="w-full space-y-4">
              {[
                { code: 'en', label: 'English' },
                { code: 'bn', label: 'বাংলা ' },
                { code: 'hi', label: 'हिन्दी ' },
                { code: 'ur', label: 'اردو ' }
              ].map(lang => (
                <button
                  key={lang.code}
                  onClick={() => i18n.changeLanguage(lang.code)}
                  className={`w-full glass-panel btn-glow p-4 rounded-xl font-bold flex items-center justify-between transition-all ${i18n.language === lang.code ? 'neon-border-cyan neon-text-cyan bg-cyan-500/10' : 'text-gray-300 hover:text-white neon-border-pink'}`}
                >
                  <span className="text-lg">{lang.label}</span>
                  {i18n.language === lang.code && <Check className="h-5 w-5" />}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                localStorage.setItem('appLanguage', i18n.language);
                setCurrentView('businessSelection');
              }}
              className="w-full mt-8 btn-glow flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-bold text-white glass-panel neon-border-cyan transition-transform hover:-translate-y-1"
            >
              {t('continue')} <ArrowRightLeft className="h-5 w-5 neon-text-cyan" />
            </button>
          </div>
        )}

        {/* ================= BUSINESS SELECTION VIEW ================= */}
        {currentView === 'businessSelection' && (
          <div className="space-y-6 animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[80vh]">
            <div className="glass-panel w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm mt-4 neon-border-cyan">
              <BookOpen className="h-10 w-10 neon-text-cyan" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight neon-text-cyan text-center">{t('businessProfiles')}</h1>
            <p className="text-gray-400 mt-2 text-sm text-center mb-8">{t('selectCompany')}</p>

            <div className="w-full space-y-4">
              {businesses.map(biz => (
                <button
                  key={biz.id}
                  onClick={() => handleSelectBusiness(biz.id)}
                  className="w-full glass-panel btn-glow p-4 rounded-xl font-bold flex items-center justify-between neon-border-pink text-gray-100 transition-all hover:bg-pink-500/10"
                >
                  <span className="text-lg">{biz.name}</span>
                  <ArrowRightLeft className="h-5 w-5 neon-text-pink" />
                </button>
              ))}

              <div className="mt-8 space-y-4">
                <form onSubmit={handleAddBusiness} className="relative">
                  <input
                    type="text"
                    placeholder={t('newCompanyName')}
                    value={newBusinessName}
                    onChange={e => setNewBusinessName(e.target.value)}
                    className="w-full glass-panel btn-glow p-4 rounded-xl font-bold text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 neon-border-cyan transition-all pr-16"
                  />
                  <button
                    type="submit"
                    className="absolute right-2 top-2 p-2 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors"
                  >
                    <Plus className="h-6 w-6" />
                  </button>
                </form>

                <div className="flex items-center gap-4 py-2">
                  <div className="h-px bg-white/10 flex-1"></div>
                  <span className="text-xs font-bold text-gray-500 uppercase">{t('or') || 'OR'}</span>
                  <div className="h-px bg-white/10 flex-1"></div>
                </div>

                <form onSubmit={handleJoinBusiness} className="relative">
                  <input
                    type="text"
                    placeholder={t('joinByCompanyId') || 'Join by Company ID'}
                    value={joinBusinessId}
                    onChange={e => setJoinBusinessId(e.target.value)}
                    className="w-full glass-panel btn-glow p-4 rounded-xl font-bold text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 neon-border-purple transition-all pr-16"
                  />
                  <button
                    type="submit"
                    className="absolute right-2 top-2 p-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
                  >
                    <ArrowRightLeft className="h-6 w-6" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* ================= LOGIN VIEW ================= */}
        {currentView === 'login' && activeBusinessId && (
          <div className="space-y-6 animate-in fade-in zoom-in duration-300 flex flex-col items-center justify-center min-h-[80vh]">
            <button
              onClick={() => setCurrentView('businessSelection')}
              className="absolute top-4 left-4 p-2 glass-panel rounded-full text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="glass-panel w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm neon-border-pink">
              <Lock className="h-10 w-10 neon-text-pink" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white text-center">
              {businesses.find(b => b.id === activeBusinessId)?.name || t('company')}
            </h1>
            <p className="text-gray-400 mt-1 text-sm text-center mb-1">{t('secureLogin')}</p>
            <p className="text-cyan-400 font-mono text-xs text-center p-1.5 bg-cyan-500/10 rounded-lg inline-block text-center mb-6 border border-cyan-500/20">
              ID: {activeBusinessId}
            </p>

            <form onSubmit={handleLogin} className="w-full space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-400 ml-1 uppercase tracking-wide">{t('selectRole')}</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'admin', label: t('adminRole') },
                    { id: 'manager', label: t('managerRole') },
                    { id: 'salesman', label: t('salesmanRole') },
                    { id: 'collector', label: t('collectorRole') }
                  ].map(role => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setLoginRole(role.id)}
                      className={`glass-panel p-3 rounded-xl font-bold text-sm flex items-center justify-center transition-all ${loginRole === role.id ? 'neon-border-cyan neon-text-cyan bg-cyan-500/10' : 'text-gray-400 hover:text-white neon-border-pink'}`}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-400 ml-1 uppercase tracking-wide">{t('enterPin')}</label>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="****"
                  value={loginPin}
                  onChange={e => setLoginPin(e.target.value)}
                  className="w-full glass-panel neon-border-cyan p-4 rounded-xl font-bold text-center text-white tracking-[0.5em] text-xl placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all bg-black/40"
                  maxLength={4}
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full mt-6 btn-glow flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-bold text-white glass-panel neon-border-cyan transition-transform hover:-translate-y-1"
              >
                <Unlock className="h-5 w-5 neon-text-cyan" /> {t('accessDashboard')}
              </button>
            </form>
          </div>
        )}

        {/* ================= HOME VIEW ================= */}
        {currentView === 'home' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Header */}
            <div className="glass-panel rounded-2xl p-5 mb-8 mt-4 flex items-center justify-between neon-border-cyan">
              <div>
                <h1 className="text-2xl font-bold tracking-tight neon-text-cyan">{t('dashboard')}</h1>
                <p className="text-gray-400 mt-1 text-sm">{t('selectWalletOrInventory')}</p>
              </div>
              <button onClick={() => setShowSettings(true)} className="p-3 glass-panel rounded-full neon-border-pink hover:bg-pink-500/10 transition-colors">
                <Settings className="h-6 w-6 neon-text-pink" />
              </button>
            </div>

            {/* Top Navigation removed from Home View */}

            {cashbooks.length === 0 ? (
              <div className="glass-panel rounded-3xl p-8 text-center neon-border-cyan relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500 rounded-full mix-blend-screen filter blur-[80px] opacity-20 hidden"></div>

                <div className="glass-panel w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 neon-border-cyan">
                  <Book className="h-8 w-8 neon-text-cyan" />
                </div>
                <h3 className="text-xl font-bold text-gray-100 mb-2">{t('noAccountsYet')}</h3>
                <p className="text-gray-400 mb-6 text-sm">{t('createFirstWallet')}</p>
                <button
                  onClick={() => setCurrentView('registration')}
                  className="w-full btn-glow flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-bold text-white glass-panel neon-border-cyan"
                >
                  <Plus className="h-5 w-5 neon-text-cyan" /> {t('createNewWallet')}
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {cashbooks.map((cb, index) => {
                  const cbBal = getCashbookBalance(cb.id);
                  return (
                    <button
                      key={cb.id}
                      onClick={() => openCashbook(cb.id)}
                      className="w-full glass-panel btn-glow rounded-2xl p-5 flex items-center justify-between neon-border-pink relative overflow-hidden group"
                    >
                      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-pink-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>

                      <div className="flex items-center gap-4 text-left relative z-10">
                        <div className="glass-panel p-3 rounded-xl neon-border-pink">
                          <Wallet className="h-6 w-6 neon-text-pink" />
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-100 text-lg">{cb.name}</h3>
                          <p className="text-xs text-gray-400 font-medium">{t('card')} **** {(index + 1).toString().padStart(4, '0')}</p>
                        </div>
                      </div>
                      <div className="text-right relative z-10">
                        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">{t('balance')}</p>
                        <p className={`font-bold flex items-center justify-end text-xl ${cbBal >= 0 ? 'text-white' : 'text-red-400'}`}>
                          <CurrencyIcon className="h-4 w-4 mr-0.5 opacity-80" /> {Math.abs(cbBal).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </button>
                  );
                })}

                <button
                  onClick={() => setCurrentView('registration')}
                  className="w-full glass-panel btn-glow flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-bold text-gray-300 neon-border-cyan mt-6"
                >
                  <Plus className="h-5 w-5 neon-text-cyan" /> {t('addAnotherWallet')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================= REGISTRATION VIEW ================= */}
        {
          currentView === 'registration' && (
            <div className="space-y-6 animate-in fade-in zoom-in duration-300">
              <div className="flex items-center mb-6 relative">
                {cashbooks.length > 0 && (
                  <button
                    onClick={() => setCurrentView('home')}
                    className="absolute left-0 p-2 text-cyan-400 glass-panel rounded-full hover:bg-white/5 transition-colors btn-glow neon-border-cyan"
                  >
                    <ArrowLeft className="h-6 w-6" />
                  </button>
                )}
                <div className="w-full text-center">
                  <div className="glass-panel w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm mt-4 neon-border-pink">
                    <Book className="h-8 w-8 neon-text-pink" />
                  </div>
                  <h1 className="text-3xl font-extrabold tracking-tight neon-text-cyan">{t('createWallet')}</h1>
                </div>
              </div>

              <div className="glass-panel rounded-3xl overflow-hidden neon-border-cyan mt-2 relative">
                <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-bl from-cyan-500/10 to-transparent pointer-events-none"></div>
                <form onSubmit={handleCreateCashbook} className="p-6 space-y-6 relative z-10">

                  {/* Cashbook Name Field */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">{t('walletName')}</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Book className="h-5 w-5 text-gray-500" />
                      </div>
                      <input
                        type="text"
                        name="name"
                        value={newCashbook.name}
                        onChange={handleNewCashbookChange}
                        placeholder={t('walletNamePlaceholder')}
                        className="block w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 text-white placeholder-gray-600 rounded-2xl focus:ring-2 focus:ring-inset focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm sm:leading-6 transition-all"
                        required
                      />
                    </div>
                  </div>

                  {/* Opening Balance Field */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">{t('openingBalance')}</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <CurrencyIcon className="h-5 w-5 text-gray-500" />
                      </div>
                      <input
                        type="number"
                        name="openingBalance"
                        value={newCashbook.openingBalance}
                        onChange={handleNewCashbookChange}
                        placeholder={t('openingBalancePlaceholder')}
                        className="block w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 text-white placeholder-gray-600 rounded-2xl focus:ring-2 focus:ring-inset focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm sm:leading-6 transition-all"
                      />
                    </div>
                  </div>

                  <div className="pt-4">
                    <button
                      type="submit"
                      className="w-full btn-glow flex items-center justify-center py-4 px-8 rounded-2xl shadow-lg text-lg font-bold text-white glass-panel neon-border-cyan transition-all transform hover:-translate-y-1"
                    >
                      {t('saveAndOpen')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )
        }

        {/* ================= DASHBOARD VIEW ================= */}
        {
          currentView === 'dashboard' && activeCashbook && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Dashboard Header */}
              <div className="flex items-center justify-between mb-4 mt-2">
                <button
                  onClick={() => setCurrentView('home')}
                  className="flex items-center gap-2 p-2 px-3 glass-panel rounded-full hover:bg-white/5 transition-colors font-semibold text-sm neon-text-cyan neon-border-cyan btn-glow"
                >
                  <HomeIcon className="h-4 w-4" /> {t('allWallets')}
                </button>

                <button
                  onClick={handleLogout}
                  className="p-2 px-3 glass-panel rounded-full transition-colors font-semibold text-sm neon-border-pink hover:bg-white/5 flex items-center gap-2 text-pink-400"
                  title={t('logout')}
                >
                  <Lock className="h-4 w-4" /> {t('logout')}
                </button>
              </div>

              <div className="text-center mb-6">
                <h1 className="text-3xl font-extrabold tracking-tight neon-text-cyan">{activeCashbook.name}</h1>
                <p className="text-gray-400 mt-1 font-medium text-sm">{t('manageAssetsAndTransactions')}</p>
              </div>

              {/* Dashboard Tabs Toggle */}
              <div className="flex bg-black/40 p-1.5 rounded-2xl border border-white/5 relative z-10 w-full mb-2 overflow-x-auto whitespace-nowrap hide-scrollbar">
                <button
                  type="button"
                  onClick={() => setDashboardTab('wallet')}
                  className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-3 px-4 text-sm sm:text-base rounded-xl font-bold transition-all duration-300 ${dashboardTab === 'wallet'
                    ? 'glass-panel neon-border-cyan neon-text-cyan shadow-[0_0_15px_rgba(0,243,255,0.2)]'
                    : 'text-gray-500 hover:text-cyan-400'
                    }`}
                >
                  <Wallet className="h-4 w-4 sm:h-5 sm:w-5" /> {t('walletDetails')}
                </button>
                {currentUserRole !== 'collector' && (
                  <button
                    type="button"
                    onClick={() => setDashboardTab('inventory')}
                    className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-3 px-4 text-sm sm:text-base rounded-xl font-bold transition-all duration-300 ${dashboardTab === 'inventory'
                      ? 'glass-panel neon-border-purple neon-text-purple shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                      : 'text-gray-500 hover:text-purple-400'
                      }`}
                  >
                    <PackageOpen className="h-4 w-4 sm:h-5 sm:w-5" /> {t('inventory')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDashboardTab('due')}
                  className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-3 px-4 text-sm sm:text-base rounded-xl font-bold transition-all duration-300 ${dashboardTab === 'due'
                    ? 'glass-panel neon-border-pink neon-text-pink shadow-[0_0_15px_rgba(236,72,153,0.2)]'
                    : 'text-gray-500 hover:text-pink-400'
                    }`}
                >
                  <FileText className="h-4 w-4 sm:h-5 sm:w-5" /> Due Messages
                </button>
              </div>

              {/* WALLET DETAILS TAB */}
              {dashboardTab === 'wallet' && (
                <div className="space-y-6 animate-in slide-in-from-left-4 duration-300">


                  {/* Balance Card */}
                  <div className="glass-panel rounded-3xl p-6 relative overflow-hidden group neon-border-pink">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-pink-500/10 via-transparent to-cyan-500/10 pointer-events-none"></div>

                    {/* Circular Chart & Balance */}
                    <div className="flex flex-col items-center justify-center mb-8 relative z-10">
                      <div
                        className="w-48 h-48 rounded-full flex items-center justify-center relative shadow-lg mb-2 transition-all duration-500"
                        style={{
                          background: totalVolume === 0
                            ? 'conic-gradient(rgba(255,255,255,0.05) 0% 100%)'
                            : `conic-gradient(#00f3ff 0% ${inPercent}%, #ff00ea ${inPercent}% 100%)`,
                          boxShadow: '0 0 20px rgba(0, 243, 255, 0.2)'
                        }}
                      >
                        <div className="w-40 h-40 bg-[#0b0c10] border-4 border-[#0b0c10] rounded-full flex flex-col items-center justify-center shadow-inner absolute z-10">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{t('netBalance')}</p>
                          <h2 className={`text-2xl font-extrabold flex items-center justify-center ${netBalance >= 0 ? 'neon-text-cyan' : 'neon-text-pink'}`}>
                            <CurrencyIcon className="h-5 w-5 mr-0.5" />
                            {Math.abs(netBalance).toLocaleString('en-IN')}
                          </h2>
                        </div>
                      </div>
                      {openingBalance > 0 && (
                        <p className="text-xs text-gray-400 font-medium">{t('includingOpeningBalance', { amount: openingBalance.toLocaleString('en-IN') })}</p>
                      )}
                    </div>

                    {/* Cash In & Cash Out Info */}
                    <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-6 relative z-10">
                      <div className="text-center p-3 glass-panel border border-cyan-500/30 rounded-2xl">
                        <p className="text-xs font-semibold text-gray-400 mb-1">{t('cashIn')}</p>
                        <p className="text-lg font-bold neon-text-cyan flex items-center justify-center">
                          <CurrencyIcon className="h-4 w-4" />
                          {totalIn.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="text-center p-3 glass-panel border border-pink-500/30 rounded-2xl">
                        <p className="text-xs font-semibold text-gray-400 mb-1">{t('cashOut')}</p>
                        <p className="text-lg font-bold neon-text-pink flex items-center justify-center">
                          <CurrencyIcon className="h-4 w-4" />
                          {totalOut.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Transactions List */}
                  <div className="glass-panel rounded-3xl overflow-hidden neon-border-cyan">
                    <div className="p-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between bg-black/20 gap-4">
                      <h3 className="font-bold text-gray-200 flex items-center gap-2">
                        <FileClock className="h-5 w-5 neon-text-cyan" />
                        {t('recentTransactions')}
                      </h3>

                      {/* Export Buttons */}
                      {activeTransactions.length > 0 && (
                        <div className="flex gap-2">
                          <button
                            onClick={exportToPDF}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-200 glass-panel border border-pink-500/50 rounded-lg hover:bg-pink-500/20 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5 neon-text-pink" /> {t('exportPDF')}
                          </button>
                          <button
                            onClick={exportToExcel}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-200 glass-panel border border-cyan-500/50 rounded-lg hover:bg-cyan-500/20 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5 neon-text-cyan" /> {t('exportExcel')}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
                      {activeTransactions.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 font-medium bg-transparent">
                          {t('noTransactionsYet')} <br /> {t('clickAddEntry')}
                        </div>
                      ) : (
                        activeTransactions.map(txn => (
                          <div key={txn.id} className="p-4 hover:bg-white/5 transition-colors flex justify-between items-center whitespace-nowrap overflow-x-auto">
                            <div className="flex flex-col gap-1 min-w-[120px]">
                              <span className="font-bold text-gray-100 truncate">{txn.partyName || 'Unknown'}</span>
                              <span className="text-xs text-gray-500 font-medium flex items-center gap-1">
                                {txn.date} • <span className="neon-text-cyan">{txn.category}</span>
                              </span>
                            </div>
                            <div className="flex flex-col items-end min-w-[100px]">
                              <span className={`font-bold flex items-center ${txn.type === 'IN' ? 'neon-text-cyan' : 'neon-text-pink'}`}>
                                {txn.type === 'IN' ? '+' : '-'} <CurrencyIcon className="h-4 w-4 ml-0.5" />
                                {txn.amount.toLocaleString('en-IN')}
                              </span>
                              <span className="text-xs text-gray-500 font-medium">{txn.paymentMode}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Closing WALLET DETAILS TAB */}
                  {dashboardTab === 'wallet' && (
                    <div className="space-y-6 animate-in slide-in-from-left-4 duration-300">
                      {/* (Previous contents above remains the same) */}
                      <div className="pt-4">
                        <button
                          onClick={() => setCurrentView('entry')}
                          className="w-full glass-panel btn-glow flex items-center justify-center gap-2 py-4 px-8 rounded-2xl shadow-lg text-lg font-bold text-white neon-border-cyan transition-all transform hover:-translate-y-1"
                        >
                          <Plus className="h-6 w-6 neon-text-cyan" />
                          {t('addNewEntry')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}


              {/* WALLET INVENTORY TAB */}
              {dashboardTab === 'inventory' && (
                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                  {/* Inventory Dashboard Data */}
                  <div className="glass-panel rounded-3xl p-6 relative overflow-hidden group neon-border-purple mb-8 shadow-[0_0_25px_rgba(168,85,247,0.15)]">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-purple-500/10 via-transparent to-pink-500/10 pointer-events-none"></div>

                    <div className="flex flex-col items-center justify-center mb-8 relative z-10">
                      <div className="text-center">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em] mb-2 drop-shadow-sm">{t('netInventoryValue')}</p>
                        <div className="relative inline-block">
                          <h2 className={`text-4xl font-black flex items-center justify-center ${totalInventoryProfit >= 0 ? 'neon-text-cyan' : 'neon-text-pink'}`}>
                            <span className="text-2xl mr-1 font-bold opacity-80">৳</span>
                            {Math.abs(totalInventoryProfit).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </h2>
                          <div className={`absolute -bottom-1 left-0 w-full h-0.5 rounded-full ${totalInventoryProfit >= 0 ? 'bg-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.5)]' : 'bg-pink-500/40 shadow-[0_0_8px_rgba(236,72,153,0.5)]'}`}></div>
                        </div>
                        <p className="text-[10px] text-gray-500 font-bold uppercase mt-3 tracking-widest opacity-60">{t('estTotalProfitLoss')}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 relative z-10">
                      <div className="glass-panel p-5 rounded-2xl border border-purple-500/20 bg-purple-500/5 flex flex-col items-center group hover:bg-purple-500/10 transition-all duration-300">
                        <div className="p-2.5 bg-purple-500/10 rounded-xl mb-3 group-hover:scale-110 transition-transform">
                          <PackageOpen className="h-5 w-5 neon-text-purple" />
                        </div>
                        <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 tracking-wider">{t('invested')}</p>
                        <p className="text-lg font-black text-gray-100 flex items-center">
                          <span className="text-xs mr-1 text-purple-400 font-bold">৳</span>{totalInventoryInvestment.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <div className="glass-panel p-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 flex flex-col items-center group hover:bg-cyan-500/10 transition-all duration-300">
                        <div className="p-2.5 bg-cyan-500/10 rounded-xl mb-3 group-hover:scale-110 transition-transform">
                          <CurrencyIcon className="h-5 w-5 neon-text-cyan" />
                        </div>
                        <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 tracking-wider">{t('revenue')}</p>
                        <p className="text-lg font-black text-gray-100 flex items-center">
                          <span className="text-xs mr-1 text-cyan-400 font-bold">৳</span>{totalInventoryRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Add New Product Form */}
                  <div className="glass-panel rounded-3xl p-6 neon-border-purple relative overflow-hidden mb-6">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500 rounded-full mix-blend-screen filter blur-[80px] opacity-10 pointer-events-none"></div>
                    <h3 className="font-bold text-gray-200 mb-4 flex items-center gap-2">
                      <Plus className="h-5 w-5 neon-text-purple" /> {t('addNewProduct')}
                    </h3>
                    <form onSubmit={handleAddProduct} className="space-y-4 relative z-10">
                      <div className="flex flex-col gap-3 mb-4">
                        <input
                          type="text"
                          placeholder={t('productName')}
                          value={newProduct.name}
                          onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                          className="w-full px-4 py-2.5 bg-black/40 border border-white/10 text-white rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-sm"
                          required
                        />
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => setNewProduct({ ...newProduct, imageFile: e.target.files[0] })}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-500/10 file:text-purple-400 hover:file:bg-purple-500/20"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex gap-2 w-full sm:w-auto">
                          <input
                            type="number"
                            placeholder={t('qty')}
                            value={newProduct.quantity}
                            onChange={(e) => setNewProduct({ ...newProduct, quantity: e.target.value })}
                            className="flex-1 sm:w-20 px-4 py-2.5 bg-black/40 border border-white/10 text-white rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-sm"
                            min="1"
                            required
                          />
                          <div className="relative flex-[2] sm:w-32">
                            <span className="absolute left-3 top-2.5 text-gray-400 font-bold text-sm">৳</span>
                            <input
                              type="number"
                              placeholder={t('pricePerQty')}
                              value={newProduct.price}
                              onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                              className="w-full pl-7 pr-4 py-2.5 bg-black/40 border border-white/10 text-white rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-sm"
                              min="0"
                              step="0.01"
                              required
                            />
                          </div>
                        </div>
                      </div>
                      <button type="submit" className="w-full btn-glow py-3 rounded-xl glass-panel neon-border-purple text-white font-bold">
                        {t('addProductBtn')}
                      </button>
                    </form>
                  </div>

                  {/* Product List */}
                  <div className="space-y-4">
                    {activeInventory.length === 0 ? (
                      <div className="glass-panel rounded-3xl p-8 text-center border-white/10 text-gray-500">
                        {t('noProductsYet')}
                      </div>
                    ) : (
                      activeInventory.map(product => (
                        <div key={product.id} className="glass-panel rounded-2xl p-4 flex flex-col gap-4 neon-border-pink relative group">
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="font-bold text-lg text-gray-100">{product.name}</h3>
                              <div className="flex flex-col gap-1 mt-2">
                                <p className="text-xs text-gray-400">{t('totalInvested')}: <span className="text-gray-300">৳{product.totalExpense.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></p>
                                <p className="text-xs text-gray-400">{t('totalRevenue')}: <span className="text-green-400">৳{(product.totalRevenue || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></p>
                                <p className="text-xs font-semibold mt-1">
                                  {t('estProfit')}: <span className={`text-sm ${(product.totalRevenue || 0) - product.totalExpense >= 0 ? 'text-cyan-400' : 'text-pink-400'}`}>
                                    ৳{((product.totalRevenue || 0) - product.totalExpense).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </span>
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {currentUserRole === 'admin' && (
                                <>
                                  <button onClick={() => adminEditProduct(product.id)} className="text-gray-500 hover:text-cyan-400 p-1" title="Admin Edit Stock">
                                    <Edit2 className="h-4 w-4" />
                                  </button>
                                  <button onClick={() => deleteProduct(product.id)} className="text-gray-600 hover:text-red-500 p-1" title="Delete Product">
                                    <Plus className="h-5 w-5 rotate-45" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Recent Sales List */}
                          {(() => {
                            const sales = activeStockTransactions.filter(t => t.productId === product.id && t.type === 'OUT');
                            if (sales.length === 0) return null;
                            return (
                              <div className="mt-3 bg-black/30 rounded-xl p-3 border border-white/5">
                                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{t('recentSales')}</p>
                                <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                                  {sales.map(sale => (
                                    <div key={sale.id} className="flex justify-between items-center text-xs">
                                      <span className="text-gray-300 flex items-center gap-1.5 truncate max-w-[60%]">
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
                                        {sale.companyName !== '-' && sale.companyName ? sale.companyName : t('unknown')}
                                      </span>
                                      <span className="text-gray-400">
                                        {sale.count}x @ <span className="text-green-400 font-medium">৳{(sale.price / sale.count).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          <div className="flex items-center justify-between mt-3 pt-4 border-t border-white/5">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">{t('inStock')}:</span>
                              <span className="font-bold text-xl text-white">{product.stockCount}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openStockForm(product, 'IN')}
                                className="px-3 py-1.5 rounded-lg flex items-center justify-center text-xs font-bold text-green-400 border border-green-500/30 hover:bg-green-500/10 transition-colors"
                              >
                                + {t('entry')}
                              </button>
                              <button
                                onClick={() => openStockForm(product, 'OUT')}
                                className="px-3 py-1.5 rounded-lg flex items-center justify-center text-xs font-bold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                              >
                                - {t('out')}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Stock Transactions Log */}
                  <div className="glass-panel rounded-3xl overflow-hidden neon-border-purple mt-8">
                    <div className="p-4 border-b border-white/10 flex items-center gap-2 bg-black/20">
                      <FileClock className="h-5 w-5 neon-text-purple" />
                      <h3 className="font-bold text-gray-200">{t('stockTransactionHistory')}</h3>
                    </div>

                    <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
                      {activeStockTransactions.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 font-medium bg-transparent">
                          {t('noStockRecordsYet')}
                        </div>
                      ) : (
                        activeStockTransactions.map(txn => (
                          <div key={txn.id} className="p-4 hover:bg-white/5 transition-colors flex justify-between items-center sm:flex-row flex-col gap-3 sm:gap-0">
                            <div className="flex flex-col gap-1 w-full sm:w-auto">
                              <span className="font-bold text-gray-100 flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded-md font-bold ${txn.type === 'IN' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                  {txn.type === 'IN' ? t('in') : t('out')}
                                </span>
                                {txn.productName}
                              </span>
                              <span className="text-xs text-gray-500 font-medium">
                                {txn.date} • {txn.count} {t('itemsAt')} <CurrencyIcon className="inline h-3 w-3" />{txn.price.toLocaleString('en-IN')}
                              </span>
                              {txn.type === 'OUT' && txn.companyName !== '-' && (
                                <span className="text-xs text-gray-400 font-medium">{t('to')}: {txn.companyName}</span>
                              )}
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                              {txn.type === 'OUT' ? (
                                <div className="flex items-center gap-3">
                                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${txn.paymentStatus === 'Paid' ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-orange-400 border-orange-500/30 bg-orange-500/10'}`}>
                                    {txn.paymentStatus === 'Paid' ? t('paid') : t('due')}
                                  </span>
                                  {txn.paymentStatus === 'Due' && (
                                    <button
                                      onClick={() => markStockAsPaid(txn.id)}
                                      className="text-xs font-bold text-white bg-purple-500/20 border border-purple-500/50 hover:bg-purple-500/40 px-3 py-1 rounded-lg transition-colors"
                                    >
                                      {t('markPaid')}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-gray-500">{t('stockAdded')}</span>
                              )}

                              {currentUserRole === 'admin' && (
                                <button
                                  onClick={() => deleteStockTransaction(txn.id)}
                                  className="text-gray-500 hover:text-red-400 p-1.5 glass-panel rounded-lg border border-white/5 transition-colors"
                                  title={t('deleteRecord')}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Stock Entry/Out Modal */}
                  {activeStockProduct && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <div className="glass-panel w-full max-w-md rounded-3xl p-6 relative neon-border-cyan animate-in fade-in zoom-in duration-200">
                        <button
                          onClick={() => setActiveStockProduct(null)}
                          className="absolute top-4 right-4 text-gray-500 hover:text-white"
                        >
                          ✕
                        </button>

                        <h2 className={`text-xl font-bold mb-1 ${activeStockProduct.type === 'IN' ? 'neon-text-cyan' : 'neon-text-pink'}`}>
                          {t('stock')} {activeStockProduct.type === 'IN' ? t('entryBuy') : t('outSellUse')}
                        </h2>
                        <p className="text-sm font-semibold text-gray-400 mb-6 uppercase tracking-wider">{activeStockProduct.name}</p>

                        <form onSubmit={submitStockTransaction} className="space-y-4">
                          {/* Count */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-400 mb-1">{t('qtyCount')}</label>
                            <input
                              type="number"
                              name="count"
                              value={stockForm.count}
                              onChange={handleStockFormChange}
                              placeholder="e.g. 50"
                              className="w-full px-4 py-3 bg-black/40 border border-white/10 text-white rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                              required
                              min="1"
                            />
                          </div>

                          {/* Price */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-400 mb-1">{t('totalPriceAmount')}</label>
                            <div className="relative">
                              <span className="absolute left-3.5 top-3.5 text-gray-400 font-bold">৳</span>
                              <input
                                type="number"
                                name="price"
                                value={stockForm.price}
                                onChange={handleStockFormChange}
                                placeholder="e.g. 5000"
                                className="w-full pl-8 pr-4 py-3 bg-black/40 border border-white/10 text-white rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                              />
                            </div>
                          </div>

                          {/* Company Name */}
                          {activeStockProduct.type === 'OUT' && (
                            <div>
                              <label className="block text-xs font-semibold text-gray-400 mb-1">{t('companyPartyName')}</label>
                              <input
                                type="text"
                                name="companyName"
                                value={stockForm.companyName}
                                onChange={handleStockFormChange}
                                placeholder={t('whereIsItGoing')}
                                className="w-full px-4 py-3 bg-black/40 border border-white/10 text-white rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                              />
                            </div>
                          )}

                          {/* Payment Status */}
                          {activeStockProduct.type === 'OUT' && (
                            <div>
                              <label className="block text-xs font-semibold text-gray-400 mb-2">{t('paymentStatus')}</label>
                              <div className="flex gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="paymentStatus"
                                    value="Paid"
                                    checked={stockForm.paymentStatus === 'Paid'}
                                    onChange={handleStockFormChange}
                                  />
                                  <span className="text-sm font-medium text-gray-200">{t('paid')}</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="paymentStatus"
                                    value="Due"
                                    checked={stockForm.paymentStatus === 'Due'}
                                    onChange={handleStockFormChange}
                                  />
                                  <span className="text-sm font-medium text-gray-200">{t('due')}</span>
                                </label>
                              </div>
                            </div>
                          )}

                          <button type="submit" className={`w-full py-4 mt-2 rounded-xl text-white font-bold transition-all glass-panel ${activeStockProduct.type === 'IN' ? 'neon-border-cyan btn-glow' : 'neon-border-pink btn-glow'}`}>
                            {t('confirmTransaction')}
                          </button>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              )
              }



            </div>
          )}

        {/* ================= ENTRY VIEW ================= */}
        {currentView === 'entry' && activeCashbook && (
          <>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Header */}
              <div className="flex items-center mb-6 relative mt-2">
                <button
                  onClick={() => setCurrentView('dashboard')}
                  className="absolute left-0 p-2 text-cyan-400 glass-panel rounded-full hover:bg-white/5 transition-colors btn-glow neon-border-cyan"
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-6 w-6" />
                </button>
                <div className="w-full text-center">
                  <h1 className="text-2xl font-extrabold neon-text-pink tracking-tight">{t('addNewEntry')}</h1>
                  <p className="text-xs font-semibold text-gray-400 mt-1 uppercase tracking-wide">For {activeCashbook.name}</p>
                </div>
              </div>

              {/* Main Card */}
              <div className="glass-panel rounded-3xl overflow-hidden neon-border-pink relative">
                <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-bl from-pink-500/10 to-transparent pointer-events-none"></div>

                {/* IN / OUT Toggle */}
                <div className="flex bg-black/40 p-2 m-4 rounded-2xl border border-white/5 relative z-10">
                  {currentUserRole !== 'salesman' && (
                    <button
                      type="button"
                      onClick={() => handleTypeToggle('IN')}
                      className={`flex-1 py-3 px-4 text-center rounded-xl font-bold transition-all duration-300 ${formData.type === 'IN'
                        ? 'glass-panel neon-border-cyan neon-text-cyan shadow-[0_0_15px_rgba(0,243,255,0.3)]'
                        : 'text-gray-500 hover:text-cyan-400'
                        }`}
                    >
                      {t('cashIn')}
                    </button>
                  )}
                  {currentUserRole !== 'collector' && (
                    <button
                      type="button"
                      onClick={() => handleTypeToggle('OUT')}
                      className={`flex-1 py-3 px-4 text-center rounded-xl font-bold transition-all duration-300 ${formData.type === 'OUT'
                        ? 'glass-panel neon-border-pink neon-text-pink shadow-[0_0_15px_rgba(255,0,234,0.3)]'
                        : 'text-gray-500 hover:text-pink-400'
                        }`}
                    >
                      {t('cashOut')}
                    </button>
                  )}
                </div>

                <form onSubmit={handleTransactionSubmit} className="p-6 pt-2 space-y-6 relative z-10">

                  {/* Amount Field */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">{t('amount')}</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <CurrencyIcon className={`h-6 w-6 ${formData.type === 'IN' ? 'text-cyan-400' : 'text-pink-400'}`} />
                      </div>
                      <input
                        type="number"
                        name="amount"
                        value={formData.amount}
                        onChange={handleTransactionChange}
                        placeholder="0.00"
                        className={`block w-full pl-12 pr-4 py-4 bg-black/40 border border-white/10 text-2xl font-bold text-white rounded-2xl focus:ring-2 focus:ring-inset sm:leading-6 transition-all ${formData.type === 'IN' ? 'focus:ring-cyan-500 focus:border-cyan-500' : 'focus:ring-pink-500 focus:border-pink-500'}`}
                        required
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>

                  {/* Party Name Field */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">{t('partyName')}</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <User className="h-5 w-5 text-gray-500" />
                      </div>
                      <input
                        type="text"
                        name="partyName"
                        value={formData.partyName}
                        onChange={handleTransactionChange}
                        placeholder={t('partyName')}
                        className="block w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 text-white placeholder-gray-600 rounded-2xl focus:ring-2 focus:ring-inset focus:ring-purple-500 focus:border-purple-500 sm:text-sm sm:leading-6 transition-all"
                        required
                      />
                    </div>
                  </div>

                  {/* Category Field */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">{t('category')}</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Tag className="h-5 w-5 text-gray-500" />
                      </div>
                      <input
                        list="category-options"
                        name="category"
                        value={formData.category}
                        onChange={handleTransactionChange}
                        placeholder="Select or type category"
                        className="block w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 text-white placeholder-gray-600 rounded-2xl focus:ring-2 focus:ring-inset focus:ring-purple-500 focus:border-purple-500 sm:text-sm sm:leading-6 transition-all"
                        required
                      />
                      <datalist id="category-options">
                        <option value="Sales" />
                        <option value="Salary" />
                        <option value="Rent" />
                        <option value="Utilities" />
                        <option value="Inventory" />
                        <option value="Others" />
                      </datalist>
                    </div>
                  </div>

                  {/* Image Attachment (Bill/Receipt/Photo) */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">{t('attachPhoto')} (Optional)</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setFormData({ ...formData, imageFile: e.target.files[0] })}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-cyan-500/10 file:text-cyan-400 hover:file:bg-cyan-500/20"
                    />
                  </div>

                  {/* Optional: Link with Inventory */}
                  <div className="glass-panel p-4 rounded-2xl border border-white/5 space-y-4">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center">
                        <input
                          type="checkbox"
                          name="isInventoryLinked"
                          checked={formData.isInventoryLinked}
                          onChange={handleTransactionChange}
                          className="peer sr-only"
                        />
                        <div className="w-5 h-5 border-2 border-gray-500 rounded flex items-center justify-center peer-checked:border-cyan-500 peer-checked:bg-cyan-500 transition-all">
                          <Check className="h-3.5 w-3.5 text-black opacity-0 peer-checked:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-gray-300 group-hover:text-white transition-colors">
                        {t('linkWithInventoryProduct')}
                      </span>
                    </label>

                    {formData.isInventoryLinked && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-2">{t('selectProduct')}</label>
                          <select
                            name="selectedProductId"
                            value={formData.selectedProductId}
                            onChange={handleTransactionChange}
                            className="block w-full px-4 py-3 bg-black/40 border border-white/10 text-white rounded-xl focus:ring-2 focus:ring-inset focus:ring-purple-500 focus:border-purple-500 sm:text-sm transition-all"
                            required={formData.isInventoryLinked}
                          >
                            <option value="">{t('selectProduct')}</option>
                            {inventory.filter(item => item.cashbookId === activeCashbookId).map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({t('inStock')}: {p.stockCount})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-400 mb-2">{t('qty')}</label>
                          <input
                            type="number"
                            name="inventoryQuantity"
                            value={formData.inventoryQuantity}
                            onChange={handleTransactionChange}
                            min="1"
                            className="block w-full px-4 py-3 bg-black/40 border border-white/10 text-white rounded-xl focus:ring-2 focus:ring-inset focus:ring-purple-500 focus:border-purple-500 sm:text-sm transition-all"
                            required={formData.isInventoryLinked}
                          />
                        </div>
                      </div>
                    )}
                  </div>


                  {/* Remark Field */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-2">{t('remark')} (Optional)</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 pt-3 pointer-events-none">
                        <FileText className="h-5 w-5 text-gray-500" />
                      </div>
                      <textarea
                        name="remark"
                        value={formData.remark}
                        onChange={handleTransactionChange}
                        placeholder="Item details, bill no, etc."
                        rows={2}
                        className="block w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 text-white placeholder-gray-600 rounded-2xl focus:ring-2 focus:ring-inset focus:ring-purple-500 focus:border-purple-500 sm:text-sm sm:leading-6 transition-all"
                      />
                    </div>
                  </div>

                  {/* Payment Mode */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-3">{t('paymentMode')}</label>
                    <div className="grid grid-cols-2 gap-4">
                      <label className={`
                      flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all
                      ${formData.paymentMode === 'Cash'
                          ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400 shadow-[0_0_15px_rgba(0,243,255,0.2)]'
                          : 'border-white/10 bg-black/40 text-gray-500 hover:bg-white/5'}
                    `}>
                        <input
                          type="radio"
                          name="paymentMode"
                          value="Cash"
                          checked={formData.paymentMode === 'Cash'}
                          onChange={handleTransactionChange}
                          className="sr-only"
                        />
                        <Wallet className="h-5 w-5" />
                        <span className="font-semibold">{t('cash')}</span>
                      </label>

                      <label className={`
                      flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all
                      ${formData.paymentMode === 'Online'
                          ? 'border-purple-500 bg-purple-500/10 text-purple-400 shadow-[0_0_15px_rgba(176,38,255,0.2)]'
                          : 'border-white/10 bg-black/40 text-gray-500 hover:bg-white/5'}
                    `}>
                        <input
                          type="radio"
                          name="paymentMode"
                          value="Online"
                          checked={formData.paymentMode === 'Online'}
                          onChange={handleTransactionChange}
                          className="sr-only"
                        />
                        <CreditCard className="h-5 w-5" />
                        <span className="font-semibold">{t('online')}</span>
                      </label>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="pt-4">
                    <button
                      type="submit"
                      className="w-full glass-panel btn-glow flex items-center justify-center gap-2 py-4 px-8 rounded-2xl shadow-lg text-lg font-bold text-white neon-border-purple transition-all transform hover:-translate-y-1"
                    >
                      <Plus className="h-6 w-6 neon-text-purple" />
                      {t('saveTransaction')}
                    </button>
                  </div>

                </form>
              </div>
            </div>
          </>
        )}


      </div>

      {/* ================= SETTINGS MODAL ================= */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-sm max-h-[90vh] flex flex-col rounded-3xl relative neon-border-cyan animate-in fade-in zoom-in duration-200 overflow-hidden">

            {/* Sticky Header with Back Button */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/40 z-20 shrink-0">
              <div className="flex items-center gap-3 text-white">
                <div className="glass-panel p-2 rounded-full neon-border-cyan">
                  <Settings className="h-4 w-4 neon-text-cyan" />
                </div>
                <h2 className="text-lg font-bold">{t('settings')}</h2>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 px-3 glass-panel rounded-full text-pink-400 hover:text-white transition-colors flex items-center gap-2 neon-border-pink btn-glow"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">{t('close') || 'Back'}</span>
              </button>
            </div>

            {/* Scrollable Content Area */}
            <div className="p-6 overflow-y-auto space-y-6 bg-black/20 pb-8">

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wide">{t('appLanguage')}</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { code: 'en', label: 'English' },
                    { code: 'bn', label: 'বাংলা' },
                    { code: 'hi', label: 'हिन्दी' },
                    { code: 'ur', label: 'اردو' }
                  ].map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        i18n.changeLanguage(lang.code);
                        localStorage.setItem('appLanguage', lang.code);
                      }}
                      className={`glass-panel p-3 rounded-xl font-bold flex items-center justify-between transition-all ${i18n.language === lang.code ? 'neon-border-cyan neon-text-cyan bg-cyan-500/10 shadow-[0_0_15px_rgba(0,243,255,0.2)]' : 'text-gray-300 hover:text-white neon-border-pink hover:bg-pink-500/10'}`}
                    >
                      <span>{lang.label}</span>
                      {i18n.language === lang.code && <Check className="h-4 w-4" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 mt-6">
                <h3 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wide">{t('themeSettings')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { code: 'neon', label: t('themeNeon') },
                    { code: 'light', label: t('themeLight') },
                    { code: 'dark', label: t('themeDark') }
                  ].map(theme => (
                    <button
                      key={theme.code}
                      onClick={() => {
                        setAppTheme(theme.code);
                        localStorage.setItem('appTheme', theme.code);
                      }}
                      className={`glass-panel p-2 md:p-3 rounded-xl font-bold flex flex-col items-center justify-center gap-2 transition-all text-xs md:text-sm text-center ${appTheme === theme.code ? 'neon-border-cyan neon-text-cyan bg-cyan-500/10 shadow-[0_0_15px_rgba(0,243,255,0.2)]' : 'text-gray-300 hover:text-white neon-border-pink hover:bg-pink-500/10'}`}
                    >
                      <span>{theme.label}</span>
                      {appTheme === theme.code && <Check className="h-4 w-4" />}
                    </button>
                  ))}
                </div>
              </div>

              {currentUserRole === 'admin' && (
                <>
                  <div className="space-y-4 mt-8 glass-panel p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500 rounded-full mix-blend-screen filter blur-[50px] opacity-20 pointer-events-none"></div>
                    <h3 className="text-sm font-bold text-gray-200 mb-1 uppercase tracking-wide flex items-center gap-2 relative z-10">
                      < बुक className="h-4 w-4 text-cyan-400" /> {t('companyId') || 'Company ID'}
                    </h3>
                    <p className="text-xs text-gray-400 mb-2 relative z-10">{t('shareWithTeamDesc') || 'Share this ID with your team so they can join this business profile.'}</p>
                    <div className="flex items-center gap-2 relative z-10">
                      <code className="flex-1 bg-black/60 text-cyan-400 font-mono tracking-widest py-3 px-4 rounded-xl border border-cyan-500/30 text-center text-lg select-all">
                        {activeBusinessId}
                      </code>
                    </div>
                  </div>

                  <div className="space-y-4 mt-6">
                    <h3 className="text-sm font-semibold text-cyan-400 mb-2 uppercase tracking-wide flex items-center gap-2">
                      <Lock className="h-4 w-4" /> {t('managePins') || 'Manage PINs'}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(managePins).map(([role, pin]) => (
                        <div key={role} className="glass-panel p-3 rounded-xl border border-white/5">
                          <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">
                            {role === 'admin' ? t('adminRole') :
                              role === 'manager' ? t('managerRole') :
                                role === 'salesman' ? t('salesmanRole') :
                                  t('collectorRole')}
                          </label>
                          <input
                            type="text"
                            value={pin}
                            onChange={(e) => handlePinChange(role, e.target.value.replace(/\D/g, ''))}
                            className="w-full bg-black/40 text-center text-white font-mono tracking-widest py-1.5 rounded-lg border border-cyan-500/30 focus:border-cyan-500 focus:outline-none transition-colors"
                            maxLength={4}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-500 text-center mt-1">{t('changesSavedAuto')}</p>
                  </div>

                  <div className="space-y-4 mt-6">
                    <h3 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wide flex items-center gap-2">
                      <Database className="h-4 w-4" /> {t('dataBackup')}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={handleExportData}
                        className="glass-panel p-3 rounded-xl font-bold flex flex-col items-center justify-center gap-2 text-cyan-400 hover:bg-cyan-500/10 transition-colors border border-cyan-500/30"
                      >
                        <Download className="h-5 w-5" />
                        <span className="text-xs text-center">{t('exportData')}</span>
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="glass-panel p-3 rounded-xl font-bold flex flex-col items-center justify-center gap-2 text-pink-400 hover:bg-pink-500/10 transition-colors border border-pink-500/30"
                      >
                        <Upload className="h-5 w-5" />
                        <span className="text-xs text-center">{t('importData')}</span>
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImportData}
                        className="hidden"
                      />
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
