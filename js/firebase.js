// Firebase account and Firestore storage, shaped the way sync.js expects a server to be.
// Data lives at users/{uid}/items/{record id}: the record's fields plus k (kind), u (server time of the
// last write) and x (deleted). Deleting writes x: true instead of removing the document, so other devices
// hear about it through the same "changed since" query.
import {
  initializeApp, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut, connectAuthEmulator, initializeFirestore, collection, doc, query, where,
  onSnapshot, writeBatch, serverTimestamp, Timestamp, connectFirestoreEmulator,
} from '../vendor/firebase.js';

export function connect(config, emulator) {
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const db = initializeFirestore(app, {});
  if (emulator) {
    connectAuthEmulator(auth, `http://${emulator}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulator, 8080);
  }
  return {
    onUser: fn => onAuthStateChanged(auth, u => fn(u && { uid: u.uid, email: u.email })),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    resetPassword: email => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    backend: uid => backend(db, uid),
  };
}

function backend(db, uid) {
  const items = collection(db, 'users', uid, 'items');
  return {
    listen(since, onChanges, onError) {
      const q = since == null ? items : query(items, where('u', '>', Timestamp.fromMillis(Math.max(0, since))));
      return onSnapshot(q, { includeMetadataChanges: true }, snap => {
        const changes = [];
        for (const ch of snap.docChanges()) {
          const d = ch.doc;
          if (ch.type === 'removed' || d.metadata.hasPendingWrites) continue;   // pending ones are this device's own
          const { k, u, x, ...fields } = d.data();
          changes.push({ id: d.id, kind: k, rec: x ? null : { id: d.id, ...fields }, u: u.toMillis() });
        }
        onChanges(changes, snap.metadata.fromCache);
      }, onError);
    },
    commit(ops) {
      const batch = writeBatch(db);
      for (const { id, kind, rec } of ops) {
        const { id: _, ...fields } = rec ?? {};
        batch.set(doc(items, id), { ...fields, k: kind, u: serverTimestamp(), x: !rec });
      }
      return batch.commit();
    },
  };
}
