// The parts of the Firebase SDK the app uses. tools/vendor-firebase.sh bundles this into vendor/firebase.js.
export { initializeApp } from 'firebase/app';
export { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, connectAuthEmulator } from 'firebase/auth';
export { initializeFirestore, collection, doc, query, where, onSnapshot, writeBatch, serverTimestamp, Timestamp, connectFirestoreEmulator } from 'firebase/firestore';
