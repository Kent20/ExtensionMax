(() => {
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---------- DOM lookups (semantic, un-hashed Svelte class names only) ----------
  function getOpenedChat() { return document.querySelector('.openedChat'); }
  function getScrollContainer() {
    const opened = getOpenedChat();
    return opened ? opened.querySelector('.scrollListScrollable') : null;
  }
  function getChatTitle() {
    const h2 = document.getElementById('main-header-title');
    if (!h2) return '';
    return h2.textContent.replace(/^Окно чата с\s*/i, '').trim();
  }
  function getChatId() {
    return location.pathname;
  }
  function getChatAvatar() {
    const img = document.querySelector('.openedChat .topbar img.avatarImage');
    return img ? img.src : '';
  }
  // Канал/группу в открытом диалоге не отличить по тем же aria-label, что в списке слева
  // (там их нет в шапке) — определяем только по явному текстовому признаку под именем
  // («N подписчиков»/«N участников»). Если признака нет — считаем обычным чатом: лучше
  // изредка проиндексировать канал, чем по ошибке выключить индексацию вообще всем чатам.
  function isOpenedChatExcluded() {
    const opened = getOpenedChat();
    if (!opened) return false;
    const subtitle = opened.querySelector('.topbar .subtitle');
    const subtitleText = subtitle ? subtitle.innerText.toLowerCase() : '';
    return subtitleText.includes('подписчик') || subtitleText.includes('участник');
  }

  function getSidebarContainer() {
    const aside = document.querySelector('.aside');
    return aside ? aside.querySelector('.scrollListScrollable') : null;
  }
  // Каналы/группы помечены скрытым aria-label («канал, »/«группа, ») перед именем в списке чатов —
  // никакого другого стабильного маркера в разметке нет.
  function isGroupOrChannel(item) {
    const span = item.querySelector('.title .name .text span[aria-label]');
    if (!span) return false;
    const label = (span.getAttribute('aria-label') || '').toLowerCase();
    return label.startsWith('канал') || label.startsWith('групп');
  }
  function scrapeItem(item, chatId, chatTitle) {
    const bubbleContent = item.querySelector('.bubbleContent');
    const textEl = bubbleContent ? bubbleContent.querySelector(':scope > .text') : null;
    const text = textEl ? textEl.innerText.trim() : '';
    if (!text) return null;
    const variantEl = item.querySelector('[data-bubbles-variant]');
    const variant = variantEl ? variantEl.getAttribute('data-bubbles-variant') : 'incoming';
    const sender = variant === 'outgoing' ? 'Я' : chatTitle;
    const timeEl = item.querySelector('.meta .text');
    const time = timeEl ? timeEl.innerText.trim() : '';
    const id = hash(chatId + '|' + sender + '|' + time + '|' + text);
    return { id, chatId, sender, time, text, indexedAt: Date.now() };
  }
  function scrapeAll(container, chatId, chatTitle) {
    const items = container.querySelectorAll('.item');
    const out = [];
    items.forEach((item) => {
      const m = scrapeItem(item, chatId, chatTitle);
      if (m) out.push(m);
    });
    return out;
  }

  function sendBatch(chatId, chatTitle, avatarUrl, messages) {
    if (!messages.length) return;
    chrome.runtime.sendMessage({
      type: 'INDEX_BATCH',
      chat: { chatId, title: chatTitle, avatarUrl, updatedAt: Date.now() },
      messages,
    });
  }

  // Узнаём, что уже реально лежит в индексе для этого чата (а не доверяем отдельному
  // флагу «полностью проиндексирован», который мог разойтись с реальностью).
  function fetchKnownIds(chatId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_CHAT_MESSAGE_IDS', chatId }, (res) => {
        resolve(res && res.ok ? new Set(res.ids) : new Set());
      });
    });
  }

  // ---------- Auto backfill (scroll to top once per chat) ----------
  let backfillRunning = false;
  let backfillCancel = false;
  let liveObserver = null;
  let currentChatId = null;

  async function runBackfill(chatId, chatTitle, avatarUrl, container, knownIds) {
    backfillRunning = true;
    backfillCancel = false;
    setFabState('indexing');
    const seen = new Map(knownIds ? Array.from(knownIds, (id) => [id, true]) : []);
    const alreadyKnownCount = seen.size;
    let stagnant = 0;
    let lastHeight = -1;
    let iterations = 0;
    const MAX_ITER = 1000;
    const MAX_STAGNANT = 6;

    while (iterations < MAX_ITER && stagnant < MAX_STAGNANT && getChatId() === chatId && !backfillCancel) {
      iterations++;
      const batch = scrapeAll(container, chatId, chatTitle);
      const fresh = [];
      for (const m of batch) {
        if (!seen.has(m.id)) { seen.set(m.id, true); fresh.push(m); }
      }
      sendBatch(chatId, chatTitle, avatarUrl, fresh);

      container.scrollTop = 0;
      await sleep(400);

      const h = container.scrollHeight;
      if (h === lastHeight) stagnant++; else stagnant = 0;
      lastHeight = h;
    }

    const collected = seen.size - alreadyKnownCount;
    if (backfillCancel) {
      if (collected > 0) showToast(`Индексация прервана. Собрано ${collected} новых сообщений — они сохранены.`);
    } else if (collected > 0) {
      showToast(`«${chatTitle || chatId}» проиндексирован: ${collected} сообщений`);
    }
    backfillCancel = false;
    backfillRunning = false;
    setFabState('idle');
  }

  function attachLiveObserver(chatId, chatTitle, avatarUrl, container) {
    if (liveObserver) liveObserver.disconnect();
    const debounced = debounce(() => {
      if (getChatId() !== chatId) return; // chat changed before debounce fired
      const batch = scrapeAll(container, chatId, chatTitle);
      sendBatch(chatId, chatTitle, avatarUrl, batch);
    }, 600);
    liveObserver = new MutationObserver(debounced);
    liveObserver.observe(container, { childList: true, subtree: true, characterData: true });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  async function handleChat(chatId, chatTitle, avatarUrl, container) {
    if (backfillRunning) return;
    attachLiveObserver(chatId, chatTitle, avatarUrl, container);
    const knownIds = await fetchKnownIds(chatId);
    if (knownIds.size === 0) {
      // в индексе для этого чата вообще ничего нет — нужен полный скролл с нуля
      runBackfill(chatId, chatTitle, avatarUrl, container, knownIds);
    } else {
      // уже индексировали раньше — просто докидываем то, чего ещё нет среди видимого,
      // без повторного скролла по всей истории
      const visible = scrapeAll(container, chatId, chatTitle);
      const fresh = visible.filter((m) => !knownIds.has(m.id));
      sendBatch(chatId, chatTitle, avatarUrl, fresh);
    }
  }

  async function onChatChanged(chatId, container) {
    await sleep(500); // дать шапке/композеру дорендериться перед проверкой типа диалога
    if (getChatId() !== chatId) return; // уже переключились на другой чат
    if (isOpenedChatExcluded()) return; // канал/группа — не индексируем
    handleChat(chatId, getChatTitle(), getChatAvatar(), container);
  }

  function poll() {
    const container = getScrollContainer();
    if (container) {
      const chatId = getChatId();
      if (chatId !== currentChatId && !backfillRunning) {
        currentChatId = chatId;
        onChatChanged(chatId, container);
      }
    }
  }
  setInterval(poll, 1200);
  poll();

  // ---------- Crawl all 1:1 chats in the sidebar (skips groups/channels) ----------
  let crawlRunning = false;
  let crawlCancel = false;

  async function waitForBackfillCycle(timeoutMs = 60000) {
    const start = Date.now();
    let sawRunning = false;
    while (Date.now() - start < 3000) {
      if (backfillRunning) { sawRunning = true; break; }
      await sleep(150);
    }
    if (sawRunning) {
      while (backfillRunning && Date.now() - start < timeoutMs) await sleep(300);
    } else {
      await sleep(500);
    }
  }

  async function crawlAllChats() {
    if (crawlRunning) return;
    const ok = await miConfirm({
      title: 'Просканировать все чаты?',
      message: mlines(
        'По очереди откроет все личные чаты (не группы и не каналы) и проиндексирует историю.\n\n' +
        'Важно: открытие чата помечает непрочитанные сообщения как прочитанные у собеседника — это стандартное поведение MAX, расширение его не отключает.'
      ),
      confirmText: 'Начать',
    });
    if (!ok) return;

    const sidebar = getSidebarContainer();
    if (!sidebar) { showToast('Не нашёл список чатов слева.'); return; }

    crawlRunning = true;
    crawlCancel = false;
    setFabState('indexing');
    closeOverlay();

    const processed = new Set();
    let stagnantScroll = 0;
    let totalDone = 0;

    sidebar.scrollTop = 0;
    await sleep(300);

    while (!crawlCancel) {
      const items = Array.from(sidebar.querySelectorAll('.item'));
      let clickedSomething = false;

      for (const item of items) {
        if (crawlCancel) break;
        if (isGroupOrChannel(item)) continue;
        const cell = item.querySelector('.cell');
        if (!cell) continue;
        const nameText = (item.querySelector('.title .name .text') || {}).innerText || '';
        const timeText = (item.querySelector('.time') || {}).innerText || '';
        const itemKey = nameText + '|' + timeText;
        if (!nameText || processed.has(itemKey)) continue;
        processed.add(itemKey);

        cell.click();
        await sleep(300);
        poll();
        await waitForBackfillCycle();
        totalDone++;
        showToast(`Просканировано чатов: ${totalDone}…`);
        clickedSomething = true;
        await sleep(200);
      }

      if (crawlCancel) break;
      const prevHeight = sidebar.scrollHeight;
      sidebar.scrollTop = sidebar.scrollHeight;
      await sleep(500);
      if (sidebar.scrollHeight === prevHeight && !clickedSomething) stagnantScroll++;
      else stagnantScroll = 0;
      if (stagnantScroll >= 3) break;
    }

    crawlRunning = false;
    setFabState('idle');
    showToast(crawlCancel ? `Остановлено. Просканировано ${totalDone} чатов.` : `Готово! Просканировано ${totalDone} чатов.`);
  }

  // ---------- FAB ----------
  let fabState = 'idle';
  function setFabState(state) {
    fabState = state;
    const fab = document.getElementById('mi-fab');
    if (fab) fab.classList.toggle('mi-fab--busy', state === 'indexing');
  }

  function buildFab() {
    if (document.getElementById('mi-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'mi-fab';
    fab.setAttribute('aria-label', 'Поиск по истории MAX');
    fab.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/>
      <path d="M20 20L15.5 15.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    fab.addEventListener('click', async () => {
      if (crawlRunning) {
        const ok = await miConfirm({
          title: 'Остановить сканирование?',
          message: mlines('Уже собранные сообщения останутся в индексе — прогресс не потеряется.'),
          confirmText: 'Остановить',
          danger: true,
        });
        if (ok) { crawlCancel = true; backfillCancel = true; }
        return;
      }
      if (backfillRunning) {
        const ok = await miConfirm({
          title: 'Прервать индексацию чата?',
          message: mlines('Уже собранные сообщения сохранятся. Можно продолжить позже, открыв чат снова.'),
          confirmText: 'Прервать',
          danger: true,
        });
        if (ok) backfillCancel = true;
        return;
      }
      openOverlay();
    });
    document.body.appendChild(fab);
  }

  // ---------- Custom confirm dialog (replaces native confirm()) ----------
  function mlines(text) {
    return text.split('\n').map((line) => escapeHtml(line)).join('<br>');
  }

  function miConfirm({ title, message, confirmText = 'Да', cancelText = 'Отмена', danger = false }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.id = 'mi-confirm';
      wrap.innerHTML = `
        <div class="mi-backdrop" data-act="cancel"></div>
        <div class="mi-confirmPanel" role="alertdialog" aria-modal="true">
          <div class="mi-confirmTitle">${escapeHtml(title)}</div>
          <div class="mi-confirmMsg">${message}</div>
          <div class="mi-confirmActions">
            <button class="mi-btn mi-btn--ghost" data-act="cancel" type="button">${escapeHtml(cancelText)}</button>
            <button class="mi-btn ${danger ? 'mi-btn--danger' : 'mi-btn--accent'}" data-act="confirm" type="button">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);
      requestAnimationFrame(() => wrap.classList.add('mi-confirm--open'));

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      }
      function cleanup(result) {
        wrap.classList.remove('mi-confirm--open');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => wrap.remove(), 160);
        resolve(result);
      }
      wrap.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        if (act) cleanup(act.dataset.act === 'confirm');
      });
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => wrap.querySelector('[data-act="confirm"]').focus(), 50);
    });
  }

  function showToast(text) {
    let toast = document.getElementById('mi-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mi-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    clearTimeout(toast._hideTimer);
    requestAnimationFrame(() => toast.classList.add('mi-toast--show'));
    toast._hideTimer = setTimeout(() => toast.classList.remove('mi-toast--show'), 3500);
  }

  document.addEventListener('keydown', (e) => {
    const mod = navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openOverlay();
    }
  }, true);

  // ---------- Overlay ----------
  let overlayEl = null;
  let selectedIndex = -1;
  let currentResults = [];

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightAll(snippetText, query) {
    const re = new RegExp(escapeRegExp(query), 'gi');
    let result = '';
    let last = 0;
    let match;
    while ((match = re.exec(snippetText))) {
      result += escapeHtml(snippetText.slice(last, match.index));
      result += '<span class="mi-mark">' + escapeHtml(match[0]) + '</span>';
      last = match.index + match[0].length;
    }
    result += escapeHtml(snippetText.slice(last));
    return result;
  }

  function highlightPlain(text, query) {
    if (!text.toLowerCase().includes(query.toLowerCase())) return escapeHtml(text);
    return highlightAll(text, query);
  }

  function markedSnippet(text, query, radius = 70) {
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return escapeHtml(text.slice(0, 140));
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + q.length + radius);
    const snippet = text.slice(start, end);
    return (start > 0 ? '…' : '') + highlightAll(snippet, query) + (end < text.length ? '…' : '');
  }

  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(h) % 360}, 50%, 42%)`;
  }

  function avatarHtml(m) {
    if (m.avatarUrl) return `<img class="mi-avatar" src="${escapeHtml(m.avatarUrl)}" alt="" />`;
    const letter = (m.chatTitle || '?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="mi-avatar mi-avatar--fallback" style="background:${avatarColor(m.chatTitle || '')}">${escapeHtml(letter)}</div>`;
  }

  function buildOverlay() {
    if (overlayEl) return overlayEl;
    const wrap = document.createElement('div');
    wrap.id = 'mi-overlay';
    wrap.innerHTML = `
      <div class="mi-backdrop" data-close></div>
      <div class="mi-panel" role="dialog" aria-modal="true">
        <div class="mi-inputRow">
          <svg class="mi-inputIcon" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M20 20L15.5 15.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="mi-input" type="text" placeholder="Искать в сообщениях…" autocomplete="off" spellcheck="false" />
          <span class="mi-esc">esc</span>
        </div>
        <div class="mi-results" id="mi-results"></div>
        <div class="mi-footer">
          <span id="mi-footer-text">—</span>
          <div class="mi-footerActions">
            <button id="mi-crawl" class="mi-resetBtn" type="button">Просканировать все чаты</button>
            <button id="mi-reset" class="mi-resetBtn mi-resetBtn--danger" type="button">Очистить индекс</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    overlayEl = wrap;

    wrap.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeOverlay));
    const input = wrap.querySelector('#mi-input');
    const debouncedSearch = debounce((q) => doSearch(q), 150);
    input.addEventListener('input', () => debouncedSearch(input.value.trim()));
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeOverlay();
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
    });
    wrap.querySelector('#mi-results').addEventListener('click', (e) => {
      if (e.target.closest('#mi-showMore')) {
        recentVisibleCount += 10;
        renderRecentList();
        return;
      }
      const jumpBtn = e.target.closest('.mi-jumpBtn');
      if (jumpBtn) {
        e.stopPropagation();
        const m = currentResults[Number(jumpBtn.dataset.index)];
        if (m) openResult(m);
        return;
      }
      const row = e.target.closest('.mi-row');
      if (!row) return;
      const m = currentResults[Number(row.dataset.index)];
      if (m) openChatOnly(m);
    });
    wrap.querySelector('#mi-reset').addEventListener('click', resetIndex);
    wrap.querySelector('#mi-crawl').addEventListener('click', crawlAllChats);
    return wrap;
  }

  function openSelected() {
    if (selectedIndex < 0 || !currentResults[selectedIndex]) return;
    openChatOnly(currentResults[selectedIndex]);
  }

  function openChatOnly(m) {
    closeOverlay();
    if (getChatId() === m.chatId) return;
    location.href = location.origin + m.chatId;
  }

  // Ждём не просто смены URL (она происходит мгновенно при навигации), а пока
  // в DOM реально появятся отрендеренные сообщения — иначе скролл-поиск стартует
  // вхолостую и молча сдаётся.
  async function waitForChatReady(chatId, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (getChatId() === chatId) {
        const container = getScrollContainer();
        if (container && container.querySelector('.item')) {
          poll();
          return container;
        }
      }
      await sleep(250);
    }
    return null;
  }

  function flashHighlight(el) {
    el.classList.add('mi-jump-flash');
    setTimeout(() => el.classList.remove('mi-jump-flash'), 2200);
  }

  // Реального ID сообщения у нас нет (MAX не отдаёт его в разметке), поэтому ищем
  // сообщение скроллом по той же логике, что и бэкфилл, сверяя по хэшу-id из индекса.
  async function jumpToMessage(chatId, targetMessage, container, timeoutMs = 20000) {
    const start = Date.now();
    let lastHeight = -1;
    let stagnant = 0;
    while (Date.now() - start < timeoutMs) {
      if (getChatId() !== chatId) return false;
      const items = container.querySelectorAll('.item');
      for (const item of items) {
        const scraped = scrapeItem(item, chatId, targetMessage.chatTitle);
        if (scraped && scraped.id === targetMessage.id) {
          item.scrollIntoView({ block: 'center' });
          flashHighlight(item);
          return true;
        }
      }
      container.scrollTop = 0;
      await sleep(350);
      const h = container.scrollHeight;
      if (h === lastHeight) stagnant++; else stagnant = 0;
      lastHeight = h;
      if (stagnant >= 6) break;
    }
    return false;
  }

  const PENDING_JUMP_KEY = 'maxIndexerPendingJump';

  async function openResult(m) {
    closeOverlay();
    if (getChatId() === m.chatId) {
      const container = await waitForChatReady(m.chatId, 5000);
      if (!container) { showToast('Чат ещё не загрузился, попробуй ещё раз.'); return; }
      showToast('Ищу сообщение…');
      const success = await jumpToMessage(m.chatId, m, container);
      if (!success) showToast('Не нашёл это сообщение в чате — возможно, индекс устарел.');
      return;
    }
    try { sessionStorage.setItem(PENDING_JUMP_KEY, JSON.stringify(m)); } catch (e) {}
    location.href = location.origin + m.chatId;
  }

  // После полной навигации скрипт переинициализируется — подхватываем отложенный
  // прыжок к сообщению, сохранённый перед переходом.
  async function checkPendingJump() {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_JUMP_KEY) || 'null'); } catch (e) { pending = null; }
    if (!pending) return;
    sessionStorage.removeItem(PENDING_JUMP_KEY);
    const container = await waitForChatReady(pending.chatId, 20000);
    if (!container) { showToast('Не дождался загрузки чата.'); return; }
    showToast('Ищу сообщение…');
    const success = await jumpToMessage(pending.chatId, pending, container);
    if (!success) showToast('Не нашёл это сообщение в чате — возможно, индекс устарел.');
  }
  checkPendingJump();
  async function resetIndex() {
    const ok = await miConfirm({
      title: 'Удалить весь индекс?',
      message: mlines('Все собранные сообщения будут удалены без возможности восстановления.'),
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    chrome.runtime.sendMessage({ type: 'CLEAR_ALL' }, (res) => {
      const input = overlayEl.querySelector('#mi-input');
      input.value = '';
      recentAll = [];
      if (res && res.ok) {
        renderRecentList(0);
      } else {
        overlayEl.querySelector('#mi-footer-text').textContent = 'Ошибка очистки';
      }
    });
  }

  function moveSelection(delta) {
    if (!currentResults.length) return;
    selectedIndex = (selectedIndex + delta + currentResults.length) % currentResults.length;
    renderActiveRow();
  }
  function renderActiveRow() {
    const rows = overlayEl.querySelectorAll('.mi-row');
    rows.forEach((r, i) => r.classList.toggle('mi-row--active', i === selectedIndex));
    if (rows[selectedIndex]) rows[selectedIndex].scrollIntoView({ block: 'nearest' });
  }

  function buildRowHtml(m, i, query) {
    const chatHtml = query ? highlightPlain(m.chatTitle, query) : escapeHtml(m.chatTitle);
    const snippetHtml = !query
      ? escapeHtml(m.text.slice(0, 140))
      : m.matchedByName
        ? escapeHtml(m.text.slice(0, 140))
        : markedSnippet(m.text, query);
    return `
      <div class="mi-row${i === 0 ? ' mi-row--active' : ''}" data-index="${i}">
        ${avatarHtml(m)}
        <div class="mi-rowBody">
          <div class="mi-rowTop">
            <span class="mi-chat">${chatHtml}</span>
            <span class="mi-time">${escapeHtml(m.time || '')}</span>
          </div>
          <div class="mi-snippet">${snippetHtml}</div>
        </div>
        <button class="mi-jumpBtn" data-index="${i}" type="button" title="Перейти к сообщению" aria-label="Перейти к сообщению">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
  }

  let recentAll = [];
  let recentVisibleCount = 10;

  function renderRecentList(total) {
    const resultsEl = overlayEl.querySelector('#mi-results');
    const footerText = overlayEl.querySelector('#mi-footer-text');
    if (!recentAll.length) {
      resultsEl.innerHTML = '<div class="mi-empty">Пока ничего не проиндексировано.<br>Открой пару чатов — и здесь появится история.</div>';
      currentResults = [];
      selectedIndex = -1;
      return;
    }
    currentResults = recentAll.slice(0, recentVisibleCount);
    const rowsHtml = currentResults.map((m, i) => buildRowHtml(m, i, '')).join('');
    const moreCount = Math.min(10, recentAll.length - recentVisibleCount);
    const moreHtml = moreCount > 0
      ? `<button id="mi-showMore" class="mi-showMoreBtn" type="button">Показать ещё ${moreCount}</button>`
      : '';
    resultsEl.innerHTML = '<div class="mi-sectionLabel">Последние проиндексированные</div>' + rowsHtml + moreHtml;
    selectedIndex = 0;
    renderActiveRow();
    if (typeof total === 'number') footerText.textContent = `${total} сообщений проиндексировано`;
  }

  function loadAndRenderRecent() {
    const resultsEl = overlayEl.querySelector('#mi-results');
    resultsEl.innerHTML = '<div class="mi-empty">Загрузка…</div>';
    recentVisibleCount = 10;
    chrome.runtime.sendMessage({ type: 'RECENT' }, (res) => {
      if (!res || !res.ok) return;
      recentAll = res.results;
      renderRecentList(res.total);
    });
  }

  function doSearch(query) {
    const resultsEl = overlayEl.querySelector('#mi-results');
    const footerText = overlayEl.querySelector('#mi-footer-text');
    if (!query) {
      loadAndRenderRecent();
      return;
    }
    chrome.runtime.sendMessage({ type: 'SEARCH', query }, (res) => {
      if (!res || !res.ok) return;
      currentResults = res.results;
      selectedIndex = currentResults.length ? 0 : -1;
      if (!currentResults.length) {
        resultsEl.innerHTML = '<div class="mi-empty">Ничего не найдено.<br>Попробуй другое слово.</div>';
      } else {
        resultsEl.innerHTML = currentResults.map((m, i) => buildRowHtml(m, i, query)).join('');
      }
      footerText.textContent = `${res.total} сообщений проиндексировано`;
    });
  }

  function openOverlay() {
    const wrap = buildOverlay();
    wrap.classList.add('mi-overlay--open');
    const input = wrap.querySelector('#mi-input');
    input.value = '';
    loadAndRenderRecent();
    setTimeout(() => input.focus(), 50);
  }
  function closeOverlay() {
    if (overlayEl) overlayEl.classList.remove('mi-overlay--open');
  }

  buildFab();
})();
