const DB_NAME = 'DokumentenArchivDB';
const DB_VERSION = 2;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('documents')) {
        db.deleteObjectStore('documents');
      }
      const store = db.createObjectStore('documents', { keyPath: 'id' });
      store.createIndex('sourceHash', 'sourceHash', { unique: false });
      store.createIndex('docType', 'docType', { unique: false });
      store.createIndex('category', 'category', { unique: false });
      store.createIndex('docDate', 'docDate', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDocument(doc) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').put(doc);
    tx.oncomplete = () => resolve(doc);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteDocumentLocal(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllDocuments() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllDocuments() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readonly');
    const req = tx.objectStore('documents').getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => (b.docDate || b.createdAt || '').localeCompare(a.docDate || a.createdAt || ''));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function findBySourceHash(hash) {
  if (!hash) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readonly');
    const idx = tx.objectStore('documents').index('sourceHash');
    const req = idx.get(hash);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function searchDocuments(query, filterChip = 'all', category = '') {
  const all = await getAllDocuments();
  const q = (query || '').trim().toLowerCase();

  return all.filter(doc => {
    if (filterChip === 'open' && doc.status !== 'open') return false;
    if (['Rechnung', 'Vertrag', 'Bescheid'].includes(filterChip) && doc.docType !== filterChip) return false;
    if (category && doc.category !== category) return false;

    if (!q) return true;
    const haystack = [
      doc.title,
      doc.sender,
      doc.summary,
      doc.fullText,
      doc.referenceNo,
      ...(doc.tags || [])
    ].join(' ').toLowerCase();

    return haystack.includes(q);
  });
}
