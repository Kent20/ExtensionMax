importScripts('db.js', 'search.js');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'INDEX_BATCH') {
    (async () => {
      try {
        if (msg.chat) await putChat(msg.chat);
        const saved = await putMessages(msg.messages || []);
        sendResponse({ ok: true, saved });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg.type === 'SEARCH') {
    (async () => {
      try {
        const rawQuery = (msg.query || '').trim();
        if (!rawQuery) return sendResponse({ ok: true, results: [], total: 0 });
        const q = normalizeText(rawQuery);
        const qWords = tokenize(q);
        const [messages, chats] = await Promise.all([getAllMessages(), getAllChats()]);
        const chatMap = new Map(chats.map((c) => [c.chatId, c]));
        const nameMatchChatIds = new Set(
          chats.filter((c) => textMatchesQuery(c.title || '', q, qWords)).map((c) => c.chatId)
        );
        const results = messages
          .filter((m) => textMatchesQuery(m.text, q, qWords) || nameMatchChatIds.has(m.chatId))
          .sort((a, b) => (b.indexedAt || 0) - (a.indexedAt || 0))
          .slice(0, 100)
          .map((m) => {
            const chat = chatMap.get(m.chatId) || {};
            return {
              ...m,
              chatTitle: chat.title || m.chatId,
              avatarUrl: chat.avatarUrl || '',
              matchedByName: nameMatchChatIds.has(m.chatId) && !textMatchesQuery(m.text, q, qWords),
            };
          });
        sendResponse({ ok: true, results, total: messages.length });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg.type === 'GET_CHAT_MESSAGE_IDS') {
    (async () => {
      try {
        const ids = await getMessageIdsByChat(msg.chatId);
        sendResponse({ ok: true, ids });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg.type === 'RECENT') {
    (async () => {
      try {
        const [messages, chats] = await Promise.all([getAllMessages(), getAllChats()]);
        const chatMap = new Map(chats.map((c) => [c.chatId, c]));
        const results = messages
          .sort((a, b) => (b.indexedAt || 0) - (a.indexedAt || 0))
          .slice(0, 200)
          .map((m) => {
            const chat = chatMap.get(m.chatId) || {};
            return { ...m, chatTitle: chat.title || m.chatId, avatarUrl: chat.avatarUrl || '' };
          });
        sendResponse({ ok: true, results, total: messages.length });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg.type === 'GET_STATS') {
    (async () => {
      try {
        const count = await countMessages();
        const chats = await getAllChats();
        sendResponse({ ok: true, count, chats });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg.type === 'CLEAR_ALL') {
    (async () => {
      try {
        await clearAll();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});
