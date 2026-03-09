import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyCe2RsqybOlRtIO41j0Nw7yvReq6_fWQWs",
    authDomain: "cashbook-pro-5a9b6.firebaseapp.com",
    projectId: "cashbook-pro-5a9b6",
    storageBucket: "cashbook-pro-5a9b6.firebasestorage.app",
    messagingSenderId: "164920552739",
    appId: "1:164920552739:web:1bd09d5c1552f0a1bf3096",
    measurementId: "G-VK09Z2KSE9"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { app, analytics, db };
