'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  raw: null,
  fileName: '',
  messages: [],
  participants: [],
  results: [],
  excludedKeys: new Set(),
  selectedTopKeys: new Set(),
  participantByKey: new Map(),
  minDate: null,
  maxDate: null,
};

const fileInput = $('fileInput');
const dropzone = $('dropzone');
const chooseFileBtn = $('chooseFileBtn');
const calculateBtn = $('calculateBtn');
const exportBtn = $('exportBtn');
const resetBtn = $('resetBtn');
const quickPeriodBtn = $('quickPeriodBtn');
const quickPeriodMenu = $('quickPeriodMenu');
const excludeSearch = $('excludeSearch');
const clearExcludeSearch = $('clearExcludeSearch');
const copyUsernamesBtn = $('copyUsernamesBtn');

chooseFileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) loadFile(file);
});

calculateBtn.addEventListener('click', calculate);
exportBtn.addEventListener('click', exportCsv);
resetBtn.addEventListener('click', resetFilters);

quickPeriodBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  quickPeriodMenu.hidden = !quickPeriodMenu.hidden;
});
quickPeriodMenu.addEventListener('click', (e) => {
  const button = e.target.closest('[data-period]');
  if (!button) return;
  applyQuickPeriod(button.dataset.period);
  quickPeriodMenu.hidden = true;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.quick-period-wrap')) quickPeriodMenu.hidden = true;
});

excludeSearch.addEventListener('input', renderExcludeSearch);
clearExcludeSearch.addEventListener('click', () => {
  excludeSearch.value = '';
  renderExcludeSearch();
  excludeSearch.focus();
});

copyUsernamesBtn.addEventListener('click', copySelectedUsernames);

async function loadFile(file) {
  hideError();
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
    showError('Нужен JSON-файл экспорта Telegram.');
    return;
  }

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    validateExport(json);

    const messages = normalizeMessages(json.messages);
    if (!messages.length) throw new Error('В JSON не найдено сообщений с корректной датой и автором.');

    state.raw = json;
    state.fileName = file.name;
    state.messages = messages;
    state.results = [];
    state.excludedKeys = new Set();
    state.selectedTopKeys = new Set();
    state.participants = uniqueParticipants(messages);
    state.participantByKey = new Map(state.participants.map(p => [p.key, p]));
    state.minDate = messages.reduce((min, m) => !min || m.date < min ? m.date : min, null);
    state.maxDate = messages.reduce((max, m) => !max || m.date > max ? m.date : max, null);

    $('fileState').textContent = `${file.name} · ${formatNumber(messages.length)} сообщений · загружен успешно`;
    calculateBtn.disabled = false;
    exportBtn.disabled = true;
    quickPeriodBtn.disabled = false;
    excludeSearch.disabled = false;
    $('results').hidden = true;
    $('stats').hidden = true;
    $('copyNote').hidden = true;

    setDefaultDates(messages);
    renderExcludeSelected();
    renderExcludeSearch();
  } catch (err) {
    state.raw = null;
    state.messages = [];
    state.participants = [];
    state.participantByKey = new Map();
    state.excludedKeys = new Set();
    state.selectedTopKeys = new Set();
    calculateBtn.disabled = true;
    exportBtn.disabled = true;
    quickPeriodBtn.disabled = true;
    excludeSearch.disabled = true;
    $('excludeResults').innerHTML = '<div class="muted">Сначала загрузи JSON</div>';
    $('excludeSelected').innerHTML = '';
    showError(err.message || 'Не удалось прочитать JSON.');
  }
}

function validateExport(json) {
  if (!json || typeof json !== 'object') throw new Error('JSON должен содержать объект верхнего уровня.');
  if (!Array.isArray(json.messages)) throw new Error('В файле не найден массив "messages". Похоже, это не экспорт Telegram в формате JSON.');
}

function normalizeMessages(messages) {
  const normalized = [];
  for (let index = 0; index < messages.length; index++) {
    const m = messages[index];
    if (!m || m.type !== 'message') continue;
    const participant = getParticipant(m);
    const date = parseTelegramDate(m.date);
    if (!date || !participant.name) continue;
    normalized.push({
      index,
      id: m.id ?? index,
      from: participant.name,
      fromId: participant.id,
      username: participant.username,
      date,
      text: flattenText(m.text),
      media: m.media_type || '',
    });
  }
  return normalized;
}

function parseTelegramDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getParticipant(message) {
  const source = message.from && typeof message.from === 'object' ? message.from : null;
  const username = normalizeUsername(
    message.from_username ??
    message.username ??
    message.from?.username ??
    source?.username ??
    message.actor?.username
  );

  if (message.from) {
    const name = source ? String(source.name ?? source.display_name ?? source.username ?? '') : String(message.from);
    const id = message.from_id ? String(message.from_id) : (source?.id ? String(source.id) : String(name));
    return { name, id, username: username || usernameFromText(name) };
  }
  if (message.actor) {
    const sourceActor = typeof message.actor === 'object' ? message.actor : null;
    const name = sourceActor ? String(sourceActor.name ?? sourceActor.display_name ?? sourceActor.username ?? '') : String(message.actor);
    const id = message.actor_id ? String(message.actor_id) : (sourceActor?.id ? String(sourceActor.id) : String(name));
    return { name, id, username: username || usernameFromText(name) };
  }
  return { name: '', id: '', username: '' };
}

function normalizeUsername(value) {
  if (!value) return '';
  const text = String(value).trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{3,64}$/.test(text) ? text : '';
}

function usernameFromText(value) {
  const text = String(value || '').trim();
  const match = text.match(/^@([A-Za-z0-9_]{3,64})$/);
  return match ? match[1] : '';
}

function flattenText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => typeof part === 'string' ? part : String(part?.text ?? '')).join('');
}

function uniqueParticipants(messages) {
  const map = new Map();
  for (const m of messages) {
    const key = m.fromId || m.from;
    if (!map.has(key)) {
      map.set(key, { key, name: m.from, username: m.username || '', countAll: 0 });
    }
    const participant = map.get(key);
    if (!participant.username && m.username) participant.username = m.username;
    participant.countAll++;
  }
  return [...map.values()].sort((a, b) => b.countAll - a.countAll || a.name.localeCompare(b.name, 'ru'));
}

function setDefaultDates(messages) {
  if (!messages.length) {
    $('dateFrom').value = '';
    $('dateTo').value = '';
    return;
  }
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const message of messages) {
    const ts = message.date.getTime();
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
  }
  $('dateFrom').value = toDateInput(new Date(minTs));
  $('dateTo').value = toDateInput(new Date(maxTs));
}

function applyQuickPeriod(period) {
  if (!state.maxDate) return;
  const end = parseDateInput($('dateTo').value) || new Date(state.maxDate);
  let start;

  if (period === 'all') {
    start = new Date(state.minDate);
    $('dateFrom').value = toDateInput(start);
    $('dateTo').value = toDateInput(end);
    quickPeriodBtn.querySelector('span').textContent = 'Весь период';
    return;
  }

  start = new Date(end);
  const amount = Number(period.match(/\d+/)?.[0] || 1);
  const unit = period.slice(-1);
  if (unit === 'd') {
    start.setDate(start.getDate() - (amount - 1));
  } else if (unit === 'm') {
    start.setMonth(start.getMonth() - amount);
    start.setDate(start.getDate() + 1);
  } else if (unit === 'y') {
    start.setFullYear(start.getFullYear() - amount);
    start.setDate(start.getDate() + 1);
  }

  if (state.minDate && start < startOfDay(state.minDate)) start = startOfDay(state.minDate);
  $('dateFrom').value = toDateInput(start);
  $('dateTo').value = toDateInput(end);
  quickPeriodBtn.querySelector('span').textContent = buttonLabelForPeriod(period);
}

function buttonLabelForPeriod(period) {
  const labels = { '1d': '1 день', '2d': '2 дня', '7d': '7 дней', '1m': '1 месяц', '2m': '2 месяца', '3m': '3 месяца', '6m': '6 месяцев', '1y': '1 год', '2y': '2 года', 'all': 'Весь период' };
  return labels[period] || 'Выбрать период';
}

function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function renderExcludeSelected() {
  const selected = state.participants.filter(p => state.excludedKeys.has(p.key));
  $('excludeSelected').innerHTML = selected.map(p => `
    <span class="selected-chip" title="${escapeHtml(p.name)}">
      <span>${escapeHtml(formatParticipantLabel(p))}</span>
      <button type="button" data-remove-exclude="${encodeURIComponent(p.key)}" aria-label="Убрать из исключений">×</button>
    </span>
  `).join('');

  $('excludeSelected').querySelectorAll('[data-remove-exclude]').forEach(button => {
    button.addEventListener('click', () => {
      state.excludedKeys.delete(decodeURIComponent(button.dataset.removeExclude));
      renderExcludeSelected();
      renderExcludeSearch();
    });
  });
}

function renderExcludeSearch() {
  const box = $('excludeResults');
  if (!state.participants.length) {
    box.innerHTML = '<div class="muted">В чате не найдено участников</div>';
    return;
  }

  const query = excludeSearch.value.trim().toLocaleLowerCase('ru');
  const source = query
    ? state.participants.filter(p => searchTextForParticipant(p).includes(query))
    : state.participants.slice(0, 12);

  if (!source.length) {
    box.innerHTML = '<div class="muted">Ничего не найдено</div>';
    return;
  }

  const suffix = query ? '' : '<div class="muted search-hint">Показываются самые активные. Начни вводить ник для поиска.</div>';
  box.innerHTML = `${source.map(p => `
    <button class="exclude-result" type="button" data-exclude-key="${encodeURIComponent(p.key)}">
      <input class="check" type="checkbox" ${state.excludedKeys.has(p.key) ? 'checked' : ''} tabindex="-1" aria-hidden="true" />
      <span class="exclude-result-main">
        <span class="exclude-result-name">${escapeHtml(p.name)}</span>
        <span class="exclude-result-meta">${p.username ? '@' + escapeHtml(p.username) + ' · ' : ''}${formatNumber(p.countAll)} сообщений</span>
      </span>
    </button>
  `).join('')}${suffix}`;

  box.querySelectorAll('[data-exclude-key]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const key = decodeURIComponent(button.dataset.excludeKey);
      if (state.excludedKeys.has(key)) state.excludedKeys.delete(key);
      else state.excludedKeys.add(key);
      renderExcludeSelected();
      renderExcludeSearch();
    });
  });
}

function searchTextForParticipant(p) {
  return `${p.name} ${p.username ? '@' + p.username : ''} ${p.key}`.toLocaleLowerCase('ru');
}

function formatParticipantLabel(p) {
  return p.username ? `${p.name} · @${p.username}` : p.name;
}

function getExcludedKeys() {
  return new Set(state.excludedKeys);
}

function calculate() {
  hideError();
  if (!state.raw) {
    showError('Сначала загрузи JSON-файл.');
    return;
  }

  const dateFrom = parseDateInput($('dateFrom').value);
  const dateTo = $('dateTo').value ? endOfDay(parseDateInput($('dateTo').value)) : null;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    showError('Дата начала не может быть позже даты окончания.');
    return;
  }

  const excluded = getExcludedKeys();
  const map = new Map();
  let total = 0;

  for (const m of state.messages) {
    if (dateFrom && m.date < dateFrom) continue;
    if (dateTo && m.date > dateTo) continue;
    const key = m.fromId || m.from;
    if (excluded.has(key)) continue;
    total++;
    if (!map.has(key)) {
      map.set(key, { key, name: m.from, username: m.username || '', messages: 0 });
    }
    const row = map.get(key);
    if (!row.username && m.username) row.username = m.username;
    row.messages++;
  }

  let ranking = [...map.values()].sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name, 'ru'));
  const topN = $('topN').value;
  if (topN !== 'all') ranking = ranking.slice(0, Number(topN));

  state.results = ranking.map((row, i) => ({
    rank: i + 1,
    key: row.key,
    name: row.name,
    username: row.username,
    messages: row.messages,
    share: total ? row.messages / total : 0,
  }));
  state.selectedTopKeys = new Set();

  renderResults(total, map.size, dateFrom, dateTo);
}

function renderResults(total, users, from, to) {
  $('statMessages').textContent = formatNumber(total);
  $('statUsers').textContent = formatNumber(users);
  $('statPeriod').textContent = `${from ? formatDate(from) : '—'} → ${to ? formatDate(to) : '—'}`;
  $('stats').hidden = false;

  if (!state.results.length) {
    $('winner').innerHTML = '<div><div class="winner-name">Никого не найдено</div><div class="winner-count">Проверь период и список исключений.</div></div>';
    $('resultsBody').innerHTML = '';
  } else {
    const best = state.results[0];
    $('winner').innerHTML = `
      <div><div class="winner-name">🏆 ${escapeHtml(best.name)}</div><div class="winner-count">Лидер рейтинга${best.username ? ` · @${escapeHtml(best.username)}` : ''}</div></div>
      <strong>${formatNumber(best.messages)} сообщений</strong>
    `;
    $('resultsBody').innerHTML = state.results.map(row => `
      <tr>
        <td class="rank">${row.rank}</td>
        <td>
          <div class="user-cell">
            <input class="row-check" type="checkbox" data-top-key="${encodeURIComponent(row.key)}" aria-label="Выбрать ${escapeHtml(row.name)}" />
            <div class="user-info">
              <div class="user-name">${escapeHtml(row.name)}</div>
              ${row.username ? `<div class="user-username">@${escapeHtml(row.username)}</div>` : '<div class="user-username missing">username не указан в JSON</div>'}
            </div>
          </div>
        </td>
        <td class="count">${formatNumber(row.messages)}</td>
        <td class="share">${formatPercent(row.share)}</td>
      </tr>
    `).join('');
  }

  $('resultsBody').querySelectorAll('[data-top-key]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const key = decodeURIComponent(checkbox.dataset.topKey);
      if (checkbox.checked) state.selectedTopKeys.add(key);
      else state.selectedTopKeys.delete(key);
      updateCopyState();
    });
  });

  updateCopyState();
  $('copyNote').hidden = true;
  $('results').hidden = false;
  exportBtn.disabled = state.results.length === 0;
}

function updateCopyState() {
  const selected = state.results.filter(r => state.selectedTopKeys.has(r.key));
  const withUsername = selected.filter(r => r.username);
  $('selectedCount').textContent = `${formatNumber(selected.length)} выбрано`;
  copyUsernamesBtn.disabled = withUsername.length === 0;
}

async function copySelectedUsernames() {
  const selected = state.results
    .filter(r => state.selectedTopKeys.has(r.key))
    .map(r => r.username)
    .filter(Boolean)
    .map(username => '@' + username);

  if (!selected.length) {
    $('copyNote').textContent = 'У выбранных участников нет username в JSON.';
    $('copyNote').hidden = false;
    return;
  }

  const text = selected.join(', ');
  try {
    await navigator.clipboard.writeText(text);
    $('copyNote').textContent = `Скопировано: ${text}`;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    $('copyNote').textContent = `Скопировано: ${text}`;
  }
  $('copyNote').hidden = false;
}

function exportCsv() {
  if (!state.results.length) return;
  const rows = [['Место', 'Участник', 'Username', 'Сообщений', 'Доля']];
  for (const row of state.results) {
    rows.push([row.rank, row.name, row.username ? '@' + row.username : '', row.messages, formatPercent(row.share)]);
  }
  const csv = rows.map(r => r.map(csvEscape).join(';')).join('\n');
  const blob = new Blob([new Uint8Array([0xEF,0xBB,0xBF]), csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'telegram-chat-top.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function resetFilters() {
  if (!state.raw) return;
  setDefaultDates(state.messages);
  $('topN').value = '10';
  $('excludeSearch').value = '';
  state.excludedKeys = new Set();
  state.selectedTopKeys = new Set();
  $('quickPeriodBtn').querySelector('span').textContent = 'Выбрать период';
  renderExcludeSelected();
  renderExcludeSearch();
  $('results').hidden = true;
  $('stats').hidden = true;
  $('exportBtn').disabled = true;
  state.results = [];
  hideError();
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
function formatDate(date) { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date); }
function formatNumber(value) { return new Intl.NumberFormat('ru-RU').format(value); }
function formatPercent(value) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, style: 'percent' }).format(value); }
function toDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replaceAll('"', '""')}"`;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function showError(message) { $('errorBox').textContent = message; $('errorBox').hidden = false; }
function hideError() { $('errorBox').hidden = true; $('errorBox').textContent = ''; }
