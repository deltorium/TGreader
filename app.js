'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  raw: null,
  fileName: '',
  participants: [],
  results: [],
};

const fileInput = $('fileInput');
const dropzone = $('dropzone');
const chooseFileBtn = $('chooseFileBtn');
const calculateBtn = $('calculateBtn');
const exportBtn = $('exportBtn');
const resetBtn = $('resetBtn');

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
    state.raw = json;
    state.fileName = file.name;
    state.results = [];

    $('fileState').textContent = `${file.name} · загружен успешно`;
    $('calculateBtn').disabled = false;
    $('exportBtn').disabled = true;
    $('results').hidden = true;
    $('stats').hidden = true;

    const messages = normalizeMessages(json.messages);
    state.participants = uniqueParticipants(messages);
    renderExcludeList(state.participants);
    setDefaultDates(messages);
  } catch (err) {
    state.raw = null;
    state.participants = [];
    calculateBtn.disabled = true;
    exportBtn.disabled = true;
    $('excludeBox').innerHTML = '<div class="muted">Сначала загрузи JSON</div>';
    showError(err.message || 'Не удалось прочитать JSON.');
  }
}

function validateExport(json) {
  if (!json || typeof json !== 'object') throw new Error('JSON должен содержать объект верхнего уровня.');
  if (!Array.isArray(json.messages)) throw new Error('В файле не найден массив "messages". Похоже, это не экспорт Telegram в формате JSON.');
}

function normalizeMessages(messages) {
  return messages
    .filter(m => m && m.type === 'message')
    .map((m, index) => {
      const participant = getParticipant(m);
      const date = parseTelegramDate(m.date);
      return {
        index,
        id: m.id ?? index,
        from: participant.name,
        fromId: participant.id,
        date,
        text: flattenText(m.text),
        media: m.media_type || '',
      };
    })
    .filter(m => m.date && m.from);
}

function parseTelegramDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getParticipant(message) {
  if (message.from) {
    return { name: String(message.from), id: message.from_id ? String(message.from_id) : String(message.from) };
  }
  // Anonymous admins / hidden authors sometimes have no `from` field.
  if (message.actor) {
    return { name: String(message.actor), id: message.actor_id ? String(message.actor_id) : String(message.actor) };
  }
  return { name: '', id: '' };
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
    if (!map.has(key)) map.set(key, { key, name: m.from, countAll: 0 });
    map.get(key).countAll++;
  }
  return [...map.values()].sort((a,b) => b.countAll - a.countAll || a.name.localeCompare(b.name, 'ru'));
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
  const min = new Date(minTs);
  const max = new Date(maxTs);
  $('dateFrom').value = toDateInput(min);
  $('dateTo').value = toDateInput(max);
}

function toDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function renderExcludeList(participants) {
  const box = $('excludeBox');
  if (!participants.length) {
    box.innerHTML = '<div class="muted">В чате не найдено участников</div>';
    return;
  }

  box.innerHTML = participants.map((p, i) => `
    <label class="chip" title="${escapeHtml(p.name)}">
      <input type="checkbox" data-exclude-key="${encodeURIComponent(p.key)}" />
      <span>${escapeHtml(p.name)}</span>
    </label>
  `).join('');
}

function getExcludedKeys() {
  return new Set([...$('excludeBox').querySelectorAll('input[data-exclude-key]:checked')]
    .map(el => decodeURIComponent(el.dataset.excludeKey)));
}

function calculate() {
  hideError();
  if (!state.raw) {
    showError('Сначала загрузи JSON-файл.');
    return;
  }

  const dateFrom = $('dateFrom').value ? startOfDay(new Date(`${$('dateFrom').value}T00:00:00`)) : null;
  const dateTo = $('dateTo').value ? endOfDay(new Date(`${$('dateTo').value}T00:00:00`)) : null;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    showError('Дата начала не может быть позже даты окончания.');
    return;
  }

  const excluded = getExcludedKeys();
  const messages = normalizeMessages(state.raw.messages);
  const filtered = messages.filter(m => {
    if (dateFrom && m.date < dateFrom) return false;
    if (dateTo && m.date > dateTo) return false;
    const key = m.fromId || m.from;
    return !excluded.has(key);
  });

  const map = new Map();
  for (const m of filtered) {
    const key = m.fromId || m.from;
    if (!map.has(key)) map.set(key, { key, name: m.from, messages: 0 });
    map.get(key).messages++;
  }

  const total = filtered.length;
  let ranking = [...map.values()].sort((a,b) => b.messages - a.messages || a.name.localeCompare(b.name, 'ru'));
  const topN = $('topN').value;
  if (topN !== 'all') ranking = ranking.slice(0, Number(topN));

  state.results = ranking.map((row, i) => ({
    rank: i + 1,
    name: row.name,
    messages: row.messages,
    share: total ? row.messages / total : 0,
  }));

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
      <div><div class="winner-name">🏆 ${escapeHtml(best.name)}</div><div class="winner-count">Лидер рейтинга</div></div>
      <strong>${formatNumber(best.messages)} сообщений</strong>
    `;
    $('resultsBody').innerHTML = state.results.map(row => `
      <tr>
        <td class="rank">${row.rank}</td>
        <td class="user-name">${escapeHtml(row.name)}</td>
        <td class="count">${formatNumber(row.messages)}</td>
        <td class="share">${formatPercent(row.share)}</td>
      </tr>
    `).join('');
  }

  $('results').hidden = false;
  exportBtn.disabled = state.results.length === 0;
}

function exportCsv() {
  if (!state.results.length) return;
  const rows = [['Место', 'Участник', 'Сообщений', 'Доля']];
  for (const row of state.results) {
    rows.push([row.rank, row.name, row.messages, formatPercent(row.share)]);
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
  const messages = normalizeMessages(state.raw.messages);
  setDefaultDates(messages);
  $('topN').value = '10';
  $('excludeBox').querySelectorAll('input[data-exclude-key]').forEach(el => { el.checked = false; });
  $('results').hidden = true;
  $('stats').hidden = true;
  $('exportBtn').disabled = true;
  state.results = [];
  hideError();
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  return d;
}
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23,59,59,999);
  return d;
}
function formatDate(date) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
function formatNumber(value) { return new Intl.NumberFormat('ru-RU').format(value); }
function formatPercent(value) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, style: 'percent' }).format(value); }
function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replaceAll('"', '""')}"`;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function showError(message) { $('errorBox').textContent = message; $('errorBox').hidden = false; }
function hideError() { $('errorBox').hidden = true; $('errorBox').textContent = ''; }
