// Firebase account and Firestore storage, shaped the way sync.js and backup.js expect a server to be.
// Data lives at users/{uid}/items/{record id}: the record's fields plus k (kind), u (server time of the
// last write) and x (deleted). Deleting writes x: true instead of removing the document, so other devices
// hear about it through the same "changed since" query. Backups live at users/{uid}/backups/{date}, with
// their dates listed in users/{uid}/backups/_index so the list costs one read.
import {
  initializeApp, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut, connectAuthEmulator, initializeFirestore, collection, doc, getDoc,
  query, where, onSnapshot, writeBatch, serverTimestamp, Timestamp, Bytes, connectFirestoreEmulator,
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
  const items = collection(db, 'users', uid, 'items'), backups = collection(db, 'users', uid, 'backups');
  const index = doc(backups, '_index');
  return {
    backups: {
      list: async () => (await getDoc(index)).data()?.dates ?? [],
      load: async date => (await getDoc(doc(backups, date))).data()?.data.toUint8Array() ?? null,
      save(date, bytes, keep, drop) {
        const batch = writeBatch(db);
        batch.set(doc(backups, date), { data: Bytes.fromUint8Array(bytes), at: serverTimestamp() });
        batch.set(index, { dates: keep });
        for (const d of drop) batch.delete(doc(backups, d));
        return batch.commit();
      },
    },
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
