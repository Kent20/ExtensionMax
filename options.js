async function renderStats() {
  const [count, chats] = await Promise.all([countMessages(), getAllChats()]);
  document.getElementById('stats').textContent = `Проиндексировано: ${count} сообщений в ${chats.length} чатах`;
}

document.getElementById('clearData').addEventListener('click', () => {
  if (!confirm('Удалить весь собранный индекс сообщений?')) return;
  chrome.runtime.sendMessage({ type: 'CLEAR_ALL' }, (res) => {
    document.getElementById('status').textContent = res && res.ok ? 'Индекс очищен.' : 'Ошибка очистки.';
    renderStats();
  });
});

document.getElementById('exportData').addEventListener('click', async () => {
  const [messages, chats] = await Promise.all([getAllMessages(), getAllChats()]);
  const payload = { version: 1, exportedAt: Date.now(), chats, messages };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `max-index-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  document.getElementById('status').textContent = `Экспортировано: ${messages.length} сообщений, ${chats.length} чатов.`;
});

document.getElementById('importData').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const statusEl = document.getElementById('status');
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.messages) || !Array.isArray(data.chats)) {
      throw new Error('Не похоже на файл экспорта MAX Indexer');
    }
    await putChats(data.chats);
    await putMessages(data.messages);
    statusEl.textContent = `Импортировано: ${data.messages.length} сообщений, ${data.chats.length} чатов.`;
    renderStats();
  } catch (err) {
    statusEl.textContent = `Ошибка импорта: ${err.message}`;
  }
});

renderStats();
