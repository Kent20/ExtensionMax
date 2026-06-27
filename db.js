// Общий модуль доступа к IndexedDB расширения. Подключается и из background, и из popup
// (оба исполняются в origin chrome-extension://<id>, поэтому база у них общая).

const DB_NAME = 'max_index';
const DB_VERSION = 1;
const STORE_MESSAGES = 'messages';
const STORE_CHATS = 'chats';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
        store.createIndex('chatId', 'chatId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CHATS)) {
        db.createObjectStore(STORE_CHATS, { keyPath: 'chatId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putMessages(messages) {
  if (!messages.length) return 0;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = tx.objectStore(STORE_MESSAGES);
    for (const m of messages) store.put(m);
    tx.oncomplete = () => resolve(messages.length);
    tx.onerror = () => reject(tx.error);
  });
}

async function putChat(chat) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHATS, 'readwrite');
    tx.objectStore(STORE_CHATS).put(chat);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putChats(chats) {
  if (!chats.length) return 0;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHATS, 'readwrite');
    const store = tx.objectStore(STORE_CHATS);
    for (const c of chats) store.put(c);
    tx.oncomplete = () => resolve(chats.length);
    tx.onerror = () => reject(tx.error);
  });
}

async function getMessageIdsByChat(chatId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readonly');
    const req = tx.objectStore(STORE_MESSAGES).index('chatId').getAllKeys(chatId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllMessages() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readonly');
    const req = tx.objectStore(STORE_MESSAGES).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllChats() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHATS, 'readonly');
    const req = tx.objectStore(STORE_CHATS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function countMessages() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readonly');
    const req = tx.objectStore(STORE_MESSAGES).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MESSAGES, STORE_CHATS], 'readwrite');
    tx.objectStore(STORE_MESSAGES).clear();
    tx.objectStore(STORE_CHATS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
