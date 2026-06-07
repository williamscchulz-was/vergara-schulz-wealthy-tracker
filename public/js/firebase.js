// Firebase init + refs — extraído de app.js. Init fica aqui; app.js só importa.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ---- Firebase ----
const firebaseConfig = {
  apiKey: "AIzaSyA5zsPOxpOBPN8BVnJRIN0mIJ4gdlUntc8",
  authDomain: "wealthy-tracker-68658.firebaseapp.com",
  projectId: "wealthy-tracker-68658",
  storageBucket: "wealthy-tracker-68658.firebasestorage.app",
  messagingSenderId: "559892333696",
  appId: "1:559892333696:web:3272f0f8e86449f4885265"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, doc, getDoc, setDoc, deleteDoc, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch };
