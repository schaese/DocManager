import { validateIBAN, hashFile, formatFilename } from './js/validation.js';
import { saveDocument, getAllDocuments } from './js/db.js';
import { GoogleAuthManager } from './js/auth.js';
import { uploadToDrive } from './js/drive.js';
import { createCalendarEvent } from './js/calendar.js';
import { analyzeDocumentWithGemini } from './js/gemini.js';

let authManager = null;
let currentFile = null;
let currentExtractedData = null;

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupSettings();
  setupUpload();
  setupConfirmCard();
  loadArchive();
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW reg failed', err));
  }
});

function setupNavigation() {
  const buttons = document.querySelectorAll('.nav-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${view}`).classList.add('active');
      if (view === 'archive') loadArchive();
      if (view === 'deadlines') loadDeadlines();
    });
  });
}

function setupSettings() {
  const saveBtn = document.getElementById('save-settings-btn');
  const clientIdInput = document.getElementById('setting-client-id');
  const apiKeyInput = document.getElementById('setting-api-key');

  clientIdInput.value = localStorage.getItem('g_client_id') || '';
  apiKeyInput.value = localStorage.getItem('gemini_api_key') || '';

  if (clientIdInput.value) {
    authManager = new GoogleAuthManager(clientIdInput.value);
    authManager.initTokenClient();
  }

  saveBtn.addEventListener('click', () => {
    localStorage.setItem('g_client_id', clientIdInput.value);
    localStorage.setItem('gemini_api_key', apiKeyInput.value);
    authManager = new GoogleAuthManager(clientIdInput.value);
    authManager.initTokenClient();
    alert('Einstellungen gespeichert!');
  });

  document.getElementById('google-login-btn').addEventListener('click', () => {
    if (!authManager) {
      alert('Bitte ZUERST Client-ID eintragen und speichern.');
      return;
    }
    authManager.requestToken();
  });
}

function setupUpload() {
  const input = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');

  dropZone.addEventListener('click', () => input.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag');
    if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
  });

  input.addEventListener('change', (e) => {
    if (e.target.files.length) handleFileSelect(e.target.files[0]);
  });
}

async function handleFileSelect(file) {
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) {
    alert('Bitte erst den Gemini API Key in den Einstellungen (Setup) hinterlegen!');
    return;
  }

  currentFile = file;
  document.getElementById('analysis-status').classList.remove('hidden');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const base64 = e.target.result;
      const data = await analyzeDocumentWithGemini(base64, apiKey);
      currentExtractedData = data;
      renderConfirmCard(data);
    } catch (err) {
      alert('Fehler bei der KI-Analyse: ' + err.message);
    } finally {
      document.getElementById('analysis-status').classList.add('hidden');
    }
  };
  reader.readAsDataURL(file);
}

function renderConfirmCard(data) {
  const card = document.getElementById('confirm-card');
  card.classList.remove('hidden');

  document.getElementById('field-doc-type').value = data.document_type || 'SONSTIGES';
  document.getElementById('field-issuer').value = data.issuer || '';
  document.getElementById('field-date').value = data.document_date || '';
  document.getElementById('field-amount').value = data.amount || '';
  document.getElementById('field-deadline').value = data.payment_deadline || '';
  document.getElementById('field-cancellation').value = data.cancellation_deadline || '';
  document.getElementById('field-tags').value = (data.tags || []).join(', ');
  document.getElementById('field-summary').value = data.summary || '';

  const ibanInput = document.getElementById('field-iban');
  const ibanStatus = document.getElementById('iban-status');
  ibanInput.value = data.iban || '';

  if (data.iban) {
    const isValid = validateIBAN(data.iban);
    ibanStatus.textContent = isValid ? '✓ IBAN Valid' : '✕ IBAN Ungültig';
    ibanStatus.style.color = isValid ? '#22c55e' : '#ef4444';
  } else {
    ibanStatus.textContent = '';
  }

  ibanInput.addEventListener('input', () => {
    const isValid = validateIBAN(ibanInput.value);
    ibanStatus.textContent = isValid ? '✓ IBAN Valid' : '✕ IBAN Ungültig';
    ibanStatus.style.color = isValid ? '#22c55e' : '#ef4444';
  });
}

function setupConfirmCard() {
  document.getElementById('confirm-save-btn').addEventListener('click', async () => {
    if (!currentFile) return;
    const token = authManager ? authManager.getToken() : null;

    const updatedData = {
      id: Date.now().toString(),
      document_type: document.getElementById('field-doc-type').value,
      issuer: document.getElementById('field-issuer').value,
      document_date: document.getElementById('field-date').value,
      amount: parseFloat(document.getElementById('field-amount').value) || 0,
      payment_deadline: document.getElementById('field-deadline').value,
      cancellation_deadline: document.getElementById('field-cancellation').value,
      iban: document.getElementById('field-iban').value,
      tags: document.getElementById('field-tags').value.split(',').map(t => t.trim()),
      summary: document.getElementById('field-summary').value,
      sha256_hash: await hashFile(currentFile),
      createdAt: new Date().toISOString()
    };

    const targetFilename = formatFilename(updatedData);

    try {
      if (token) {
        const driveId = await uploadToDrive(currentFile, targetFilename, token);
        updatedData.drive_id = driveId;

        if (updatedData.payment_deadline) {
          await createCalendarEvent(`Zahlungsziel: ${updatedData.issuer}`, updatedData.payment_deadline, token);
        }
        if (updatedData.cancellation_deadline) {
          await createCalendarEvent(`Kündigungsfrist: ${updatedData.issuer}`, updatedData.cancellation_deadline, token);
        }
      }

      await saveDocument(updatedData);
      alert('Dokument erfolgreich archiviert!');
      document.getElementById('confirm-card').classList.add('hidden');
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    }
  });
}

async function loadArchive() {
  const list = document.getElementById('archive-list');
  list.innerHTML = '';
  const docs = await getAllDocuments();

  if (docs.length === 0) {
    list.innerHTML = '<p>Keine archivierten Dokumente vorhanden.</p>';
    return;
  }

  docs.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'doc-card';
    item.innerHTML = `
      <h3>${doc.issuer || 'Unbekannt'} (${doc.document_type})</h3>
      <p><strong>Datum:</strong> ${doc.document_date || '-'}</p>
      <p><strong>Betrag:</strong> ${doc.amount ? doc.amount + ' EUR' : '-'}</p>
      <p><strong>Tags:</strong> ${doc.tags ? doc.tags.join(', ') : '-'}</p>
      <p><em>${doc.summary || ''}</em></p>
    `;
    list.appendChild(item);
  });
}

async function loadDeadlines() {
  const list = document.getElementById('deadlines-list');
  list.innerHTML = '';
  const docs = await getAllDocuments();
  const deadlines = docs.filter(d => d.payment_deadline || d.cancellation_deadline);

  if (deadlines.length === 0) {
    list.innerHTML = '<p>Keine anstehenden Fristen gefunden.</p>';
    return;
  }

  deadlines.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'doc-card';
    item.innerHTML = `
      <h3>${doc.issuer}</h3>
      ${doc.payment_deadline ? `<p><strong>Zahlungsziel:</strong> ${doc.payment_deadline}</p>` : ''}
      ${doc.cancellation_deadline ? `<p><strong>Kündigungsfrist:</strong> ${doc.cancellation_deadline}</p>` : ''}
    `;
    list.appendChild(item);
  });
}