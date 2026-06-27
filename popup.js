let allMessages = [];
let allChats = new Map();

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(text, query) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const idx = escaped.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escaped;
  return escaped.slice(0, idx) + '<mark>' + escaped.slice(idx, idx + query.length) + '</mark>' + escaped.slice(idx + query.length);
}

function snippet(text, query, radius = 60) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 120);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function render(query) {
  const resultsEl = document.getElementById('results');
  if (!query) {
    resultsEl.innerHTML = '<div class="empty">Начни вводить запрос</div>';
    return;
  }
  const q = query.toLowerCase();
  const matches = allMessages
    .filter((m) => m.text.toLowerCase().includes(q))
    .sort((a, b) => (b.indexedAt || 0) - (a.indexedAt || 0))
    .slice(0, 200);

  if (!matches.length) {
    resultsEl.innerHTML = '<div class="empty">Ничего не найдено</div>';
    return;
  }

  resultsEl.innerHTML = matches
    .map((m) => {
      const chat = allChats.get(m.chatId);
      const chatTitle = chat ? chat.title || m.chatId : m.chatId;
      const snip = snippet(m.text, query);
      return `<div class="item">
        <div class="chat">${escapeHtml(chatTitle)}</div>
        <div class="meta">${escapeHtml(m.sender || '')} ${m.time ? '· ' + escapeHtml(m.time) : ''}</div>
        <div class="text">${highlight(snip, query)}</div>
      </div>`;
    })
    .join('');
}

async function init() {
  const [messages, chats] = await Promise.all([getAllMessages(), getAllChats()]);
  allMessages = messages;
  allChats = new Map(chats.map((c) => [c.chatId, c]));
  document.getElementById('meta').textContent = `Проиндексировано: ${messages.length} сообщений в ${chats.length} чатах`;
}

document.getElementById('q').addEventListener('input', (e) => render(e.target.value.trim()));

init();
