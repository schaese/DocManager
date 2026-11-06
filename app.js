import {
  CATEGORIES,
  DOC_TYPES,
  validateIBAN,
  validateDocumentFields,
  hashFile,
  formatFilename
} from './js/validation.js';
import {
  saveDocument,
  deleteDocumentLocal,
  clearAllDocuments,
  getAllDocuments,
  findBySourceHash,
  searchDocuments
} from './js/db.js';
import { optimizeImageFile, buildPdfFromPages, fileToDataUrl } from './js/pdf.js';
import { GoogleAuthManager } from './js/auth.js';
import {
  saveDocumentToDrive,
  updateMetaFileInDrive,
  deleteDriveFile,
  rebuildIndexFromDrive,
  saveSettingsToAppData
} from './js/drive.js';
import {
  createCalendarEvent,
  markCalendarEventDone,
  deleteCalendarEvent,
  buildCalendarFallbackUrl
} from './js/calendar.js';
import { analyzeDocumentWithGemini } from './js/gemini.js';

let authManager = null;
let capturedPages = [];
let uploadedPdfFile = null;
let currentSourceHash = '';
let activeFilterChip = 'all';
let selectedDocForModal = null;

document.addEventListener('DOMContentLoaded', () => {
  populateDropdowns();
  setupNavigation();
  setupSettings();
  setupCaptureAndUpload();
  setupConfirmCard();
  setupArchiveFilters();
  setupDetailModal();
  refreshArchiveAndTasks();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW Fehler:', err));
  }
});

function populateDropdowns() {
  const docTypeSel = document.getElementById('field-doc-type');
  DOC_TYPES.forEach(t => docTypeSel.add(new Option(t, t)));

  const catSelectors = [
    document.getElementById('field-category'),
    document.getElementById('setting-default-category'),
    document.getElementById('archive-category-filter')
  ];
  CATEGORIES.forEach(c => {
    catSelectors[0].add(new Option(c, c));
    catSelectors[1].add(new Option(c, c));
    catSelectors[2].add(new Option(c, c));
  });
}

function switchView(viewName) {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.remove('hidden');

  if (viewName === 'archive' || viewName === 'tasks') {
    refreshArchiveAndTasks();
  }
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function getSettings() {
  return {
    clientId: localStorage.getItem('g_client_id') || '',
    apiKey: localStorage.getItem('gemini_api_key') || '',
    model: localStorage.getItem('gemini_model') || 'gemini-2.5-flash',
    leadDays: Number(localStorage.getItem('reminder_lead_days') || 3),
    defaultCategory: localStorage.getItem('default_category') || 'Sonstiges',
    theme: localStorage.getItem('app_theme') || 'system',
    privacyConsent: localStorage.getItem('privacy_consent') === 'true'
  };
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function setupSettings() {
  const cfg = getSettings();
  document.getElementById('setting-client-id').value = cfg.clientId;
  document.getElementById('setting-api-key').value = cfg.apiKey;
  document.getElementById('setting-model').value = cfg.model;
  document.getElementById('setting-lead-days').value = cfg.leadDays;
  document.getElementById('setting-default-category').value = cfg.defaultCategory;
  document.getElementById('setting-theme').value = cfg.theme;
  document.getElementById('setting-privacy-consent').checked = cfg.privacyConsent;
  applyTheme(cfg.theme);

  const initAuth = (clientId) => {
    if (!clientId) return;
    authManager = new GoogleAuthManager(clientId, (loggedIn) => {
      const badge = document.getElementById('sync-badge');
      const loginBtn = document.getElementById('header-login-btn');
      badge.textContent = loggedIn ? 'Drive verbunden' : 'Lokal';
      loginBtn.textContent = loggedIn ? 'Verbunden ✓' : 'Mit Google anmelden';
    });
    authManager.initTokenClient();
  };

  initAuth(cfg.clientId);

  document.getElementById('form-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clientId = document.getElementById('setting-client-id').value.trim();
    const apiKey = document.getElementById('setting-api-key').value.trim();
    const model = document.getElementById('setting-model').value.trim() || 'gemini-2.5-flash';
    const leadDays = document.getElementById('setting-lead-days').value;
    const defaultCategory = document.getElementById('setting-default-category').value;
    const theme = document.getElementById('setting-theme').value;
    const consent = document.getElementById('setting-privacy-consent').checked;

    localStorage.setItem('g_client_id', clientId);
    localStorage.setItem('gemini_api_key', apiKey);
    localStorage.setItem('gemini_model', model);
    localStorage.setItem('reminder_lead_days', leadDays);
    localStorage.setItem('default_category', defaultCategory);
    localStorage.setItem('app_theme', theme);
    localStorage.setItem('privacy_consent', String(consent));

    applyTheme(theme);
    initAuth(clientId);

    const token = authManager ? await authManager.getValidToken() : null;
    if (token) {
      await saveSettingsToAppData({ model, leadDays, defaultCategory, theme, consentDate: new Date().toISOString() }, token).catch(() => {});
    }
    alert('Einstellungen erfolgreich gespeichert!');
  });

  document.getElementById('header-login-btn').addEventListener('click', () => {
    if (!authManager) {
      switchView('settings');
      alert('Bitte zuerst die Google OAuth Client-ID in den Einstellungen hinterlegen.');
      return;
    }
    authManager.requestToken('consent');
  });

  // FA-104: Test-Button für den Gemini-API-Schlüssel
  document.getElementById('btn-test-key').addEventListener('click', async () => {
    const key = document.getElementById('setting-api-key').value.trim();
    if (!key) return alert('Bitte zuerst einen Gemini API-Schlüssel eingeben.');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    alert(res.ok ? '✓ Gemini-Schlüssel ist gültig!' : '✕ Schlüssel ungültig oder API nicht erreichbar.');
  });

  // FA-801 & FA-803: Index aus Drive neu aufbauen
  const triggerRebuild = async () => {
    const token = authManager ? await authManager.getValidToken() : null;
    if (!token) return alert('Bitte zuerst mit Google anmelden.');
    const msg = document.getElementById('index-progress-msg');
    msg.textContent = 'Lade Metadaten aus Google Drive...';
    try {
      const docs = await rebuildIndexFromDrive(token, (done, total) => {
        msg.textContent = `Synchronisiere Dokument ${done} von ${total}...`;
      });
      await clearAllDocuments();
      for (const d of docs) await saveDocument(d);
      msg.textContent = `✓ Index erfolgreich aufgebaut (${docs.length} Dokumente).`;
      refreshArchiveAndTasks();
    } catch (err) {
      msg.textContent = 'Fehler beim Index-Aufbau: ' + err.message;
    }
  };

  document.getElementById('btn-rebuild-index').addEventListener('click', triggerRebuild);
  document.getElementById('btn-sync-drive').addEventListener('click', triggerRebuild);

  document.getElementById('btn-open-drive-root').addEventListener('click', () => {
    window.open('https://drive.google.com/drive/search?q=DokumentenArchiv', '_blank');
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    if (authManager) authManager.logout();
    alert('Abgemeldet.');
  });

  document.getElementById('btn-revoke').addEventListener('click', async () => {
    if (authManager) authManager.revoke();
    await clearAllDocuments();
    refreshArchiveAndTasks();
    alert('Google-Verbindung getrennt und lokaler Cache geleert.');
  });
}

function setupCaptureAndUpload() {
  const fileInput = document.getElementById('file-input');
  const addPageInput = document.getElementById('add-page-input');
  const dropZone = document.getElementById('drop-zone');

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag');
    if (e.dataTransfer.files.length) handleIncomingFiles(Array.from(e.dataTransfer.files));
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleIncomingFiles(Array.from(e.target.files));
  });

  addPageInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleIncomingFiles(Array.from(e.target.files));
  });

  document.getElementById('btn-clear-pages').addEventListener('click', resetScanState);
  document.getElementById('btn-start-ai').addEventListener('click', runAiExtraction);
  document.getElementById('btn-manual-entry').addEventListener('click', () => {
    populateConfirmCard({
      doc_date: new Date().toISOString().split('T')[0],
      category: getSettings().defaultCategory,
      doc_type: 'Rechnung'
    });
  });
}

function resetScanState() {
  capturedPages = [];
  uploadedPdfFile = null;
  currentSourceHash = '';
  document.getElementById('pages-panel').classList.add('hidden');
  document.getElementById('confirm-card').classList.add('hidden');
  document.getElementById('duplicate-warning').classList.add('hidden');
  document.getElementById('file-input').value = '';
}

async function handleIncomingFiles(files) {
  const statusBox = document.getElementById('analysis-status');
  const stepText = document.getElementById('analysis-step-text');

  try {
    const first = files[0];
    if (!first) return;

    statusBox.classList.remove('hidden');
    stepText.textContent = 'Datei wird geladen und geprüft...';

    // Duplikatprüfung (FA-206)
    currentSourceHash = await hashFile(first);
    const dup = await findBySourceHash(currentSourceHash);
    const dupWarn = document.getElementById('duplicate-warning');
    if (dup) {
      dupWarn.innerHTML = `⚠️ <strong>Bereits archiviert:</strong> „${dup.title}“ vom ${dup.docDate || '-'}.`;
      dupWarn.classList.remove('hidden');
    } else {
      dupWarn.classList.add('hidden');
    }

    const isPdf = first.type === 'application/pdf' || /\.pdf$/i.test(first.name);
    if (isPdf) {
      if (first.size > 15 * 1024 * 1024) {
        statusBox.classList.add('hidden');
        return alert('PDF ist größer als 15 MB (FA-203).');
      }
      uploadedPdfFile = first;
      capturedPages = [];
      await runAiExtraction();
      return;
    }

    uploadedPdfFile = null;
    for (const f of files) {
      const isImage = f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name);
      if (!isImage) continue;
      if (capturedPages.length >= 10) {
        alert('Maximal 10 Seiten pro Dokument erlaubt (FA-201).');
        break;
      }
      stepText.textContent = 'Foto wird für KI-Analyse optimiert...';
      const optimized = await optimizeImageFile(f, 0, false);
      capturedPages.push({ rawFile: f, rotation: 0, bw: false, ...optimized });
    }

    statusBox.classList.add('hidden');
    renderPagesGrid();

    // Automatisch zur Seitenvorschau und dem Button "KI-Analyse starten" scrollen
    document.getElementById('pages-panel').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    statusBox.classList.add('hidden');
    alert('Fehler beim Laden des Bildes: ' + err.message);
  }
}


function renderPagesGrid() {
  const panel = document.getElementById('pages-panel');
  const grid = document.getElementById('pages-list');
  const counter = document.getElementById('pages-counter');

  if (capturedPages.length === 0) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  counter.textContent = `${capturedPages.length} Seite(n) erfasst`;
  grid.innerHTML = '';

  capturedPages.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'page-thumb';
    div.innerHTML = `
      <img src="${p.dataUrl}" alt="Seite ${idx + 1}">
      <div class="page-thumb-actions">
        <button type="button" class="btn-small" data-act="rot" title="Drehen">↻</button>
        <button type="button" class="btn-small" data-act="bw" title="S/W-Kontrast">◐</button>
        <button type="button" class="btn-small" data-act="del" title="Löschen">🗑️</button>
      </div>
    `;
    div.querySelector('[data-act="rot"]').addEventListener('click', async () => {
      p.rotation = (p.rotation + 90) % 360;
      const opt = await optimizeImageFile(p.rawFile, p.rotation, p.bw);
      Object.assign(p, opt);
      renderPagesGrid();
    });
    div.querySelector('[data-act="bw"]').addEventListener('click', async () => {
      p.bw = !p.bw;
      const opt = await optimizeImageFile(p.rawFile, p.rotation, p.bw);
      Object.assign(p, opt);
      renderPagesGrid();
    });
    div.querySelector('[data-act="del"]').addEventListener('click', () => {
      capturedPages.splice(idx, 1);
      renderPagesGrid();
    });
    grid.appendChild(div);
  });
}

async function runAiExtraction() {
  const cfg = getSettings();
  if (!cfg.apiKey) {
    switchView('settings');
    return alert('Bitte zuerst den Gemini API-Schlüssel in den Einstellungen hinterlegen (FA-104).');
  }
  if (!cfg.privacyConsent) {
    switchView('settings');
    return alert('Bitte vor der ersten KI-Analyse dem Datenschutzhinweis in den Einstellungen zustimmen (FA-304).');
  }

  const statusBox = document.getElementById('analysis-status');
  const stepText = document.getElementById('analysis-step-text');
  statusBox.classList.remove('hidden');

  try {
    stepText.textContent = '1/3 Dokumentdaten werden vorbereitet...';
    let parts = [];
    if (uploadedPdfFile) {
      const dataUrl = await fileToDataUrl(uploadedPdfFile);
      parts = [{ dataUrl, mimeType: 'application/pdf' }];
    } else {
      parts = capturedPages.map(p => ({ dataUrl: p.dataUrl, mimeType: 'image/jpeg' }));
    }

    stepText.textContent = `2/3 KI-Extraktion mit ${cfg.model} läuft...`;
    const extracted = await analyzeDocumentWithGemini(parts, cfg.apiKey, cfg.model);

    stepText.textContent = '3/3 Prüfe Felder & IBAN...';
    populateConfirmCard(extracted);
  } catch (err) {
    alert(`KI-Analyse fehlgeschlagen: ${err.message}\nSie können die Daten jetzt manuell eintragen.`);
    populateConfirmCard({
      doc_date: new Date().toISOString().split('T')[0],
      category: cfg.defaultCategory,
      doc_type: 'Sonstiges'
    });
  } finally {
    statusBox.classList.add('hidden');
  }
}

function populateConfirmCard(data) {
  const cfg = getSettings();
  const card = document.getElementById('confirm-card');
  card.classList.remove('hidden');

  document.getElementById('field-title').value = data.title || '';
  document.getElementById('field-sender').value = data.sender || '';
  document.getElementById('field-doc-type').value = DOC_TYPES.includes(data.doc_type) ? data.doc_type : 'Information';
  document.getElementById('field-category').value = CATEGORIES.includes(data.category) ? data.category : cfg.defaultCategory;
  document.getElementById('field-doc-date').value = data.doc_date || new Date().toISOString().split('T')[0];
  document.getElementById('field-reference').value = data.reference_no || '';

  const fin = data.financial || {};
  document.getElementById('field-action-required').checked = Boolean(data.action_required);
  document.getElementById('field-amount').value = fin.amount_total ?? '';
  document.getElementById('field-due-date').value = fin.due_date || '';
  document.getElementById('field-iban').value = fin.iban || '';
  document.getElementById('field-payment-ref').value = fin.payment_reference || '';

  let reminderDate = data.reminder?.date || '';
  if (!reminderDate && fin.due_date) {
    const d = new Date(fin.due_date);
    d.setDate(d.getDate() - cfg.leadDays);
    reminderDate = d.toISOString().split('T')[0];
  }
  document.getElementById('field-reminder-date').value = reminderDate;
  document.getElementById('field-tags').value = (data.tags || []).join(', ');
  document.getElementById('field-summary').value = data.summary || '';
  document.getElementById('field-fulltext').value = data.full_text_markdown || '';

  runLiveValidation();
}

function runLiveValidation() {
  const ibanVal = document.getElementById('field-iban').value.trim();
  const ibanStatus = document.getElementById('iban-status');

  if (ibanVal) {
    const ok = validateIBAN(ibanVal);
    ibanStatus.textContent = ok ? '✓ IBAN gültig (Mod 97)' : '✕ IBAN ungültig – Speichern gesperrt';
    ibanStatus.className = ok ? 'validation-msg valid-iban' : 'validation-msg invalid-iban';
  } else {
    ibanStatus.textContent = '';
  }

  const check = validateDocumentFields({
    sender: document.getElementById('field-sender').value,
    title: document.getElementById('field-title').value,
    docDate: document.getElementById('field-doc-date').value,
    dueDate: document.getElementById('field-due-date').value,
    amount: document.getElementById('field-amount').value,
    iban: ibanVal
  });

  const errBox = document.getElementById('validation-errors');
  const saveBtn = document.getElementById('confirm-save-btn');

  if (!check.isValid) {
    errBox.innerHTML = check.errors.map(e => `<div>• ${e}</div>`).join('');
    errBox.classList.remove('hidden');
    saveBtn.disabled = true; // FA-402 & TF-03: Speichern bei fehlerhaften Zahlungsdaten sperren!
  } else {
    errBox.classList.add('hidden');
    saveBtn.disabled = false;
  }
  return check.isValid;
}

function setupConfirmCard() {
  const form = document.getElementById('form-confirm');
  form.querySelectorAll('input, select, textarea').forEach(el => {
    el.addEventListener('input', runLiveValidation);
  });

  document.getElementById('confirm-cancel-btn').addEventListener('click', resetScanState);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!runLiveValidation()) return;

    const saveBtn = document.getElementById('confirm-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Speichere...';

    try {
      const cfg = getSettings();
      const amountVal = parseFloat(document.getElementById('field-amount').value);
      const dueDate = document.getElementById('field-due-date').value || null;
      const reminderDate = document.getElementById('field-reminder-date').value || dueDate;
      const actionReq = document.getElementById('field-action-required').checked;

      // PDF aus Seiten erzeugen oder Original-PDF nutzen (FA-501)
      let pdfBlob = uploadedPdfFile;
      if (!pdfBlob && capturedPages.length > 0) {
        pdfBlob = await buildPdfFromPages(capturedPages);
      }
      if (!pdfBlob) {
        pdfBlob = new Blob(['Manueller Beleg'], { type: 'application/pdf' });
      }

      if (!currentSourceHash) {
        currentSourceHash = await hashFile(pdfBlob);
      }

      const nowIso = new Date().toISOString();
      // Exaktes Metadaten-Schema nach Kapitel 6.1 (schemaVersion 1)
      const metaRecord = {
        schemaVersion: 1,
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        createdAt: nowIso,
        updatedAt: nowIso,
        docDate: document.getElementById('field-doc-date').value,
        sender: document.getElementById('field-sender').value.trim(),
        title: document.getElementById('field-title').value.trim(),
        docType: document.getElementById('field-doc-type').value,
        category: document.getElementById('field-category').value,
        summary: document.getElementById('field-summary').value.trim(),
        fullText: document.getElementById('field-fulltext').value,
        tags: document.getElementById('field-tags').value.split(',').map(t => t.trim()).filter(Boolean),
        actionRequired: actionReq,
        financial: {
          isInvoice: document.getElementById('field-doc-type').value === 'Rechnung',
          amountTotal: !Number.isNaN(amountVal) ? amountVal : null,
          currency: 'EUR',
          dueDate,
          iban: document.getElementById('field-iban').value.trim(),
          paymentReference: document.getElementById('field-payment-ref').value.trim()
        },
        referenceNo: document.getElementById('field-reference').value.trim(),
        status: actionReq ? 'open' : 'archived',
        reminder: reminderDate ? {
          date: reminderDate,
          type: 'payment_due',
          title: `${document.getElementById('field-doc-type').value === 'Rechnung' ? 'Rechnung zahlen' : 'Frist'}: ${document.getElementById('field-sender').value.trim()}${!Number.isNaN(amountVal) ? ` (${amountVal.toFixed(2).replace('.', ',')} EUR)` : ''}`,
          calendarEventId: null,
          completed: false
        } : null,
        drive: {
          pdfFileId: '',
          metaFileId: '',
          webViewLink: '',
          folderPath: '',
          fileName: ''
        },
        sourceHash: currentSourceHash,
        ai: {
          model: cfg.model,
          extractedAt: nowIso,
          userEdited: true
        }
      };

      metaRecord.drive.fileName = formatFilename(metaRecord);

      const token = authManager ? await authManager.getValidToken() : null;
      if (token) {
        await saveDocumentToDrive(pdfBlob, metaRecord, token);

        if (metaRecord.reminder && document.getElementById('field-create-calendar').checked) {
          try {
            const calEvent = await createCalendarEvent({
              title: metaRecord.reminder.title,
              dueDate: metaRecord.reminder.date,
              driveUrl: metaRecord.drive.webViewLink,
              docId: metaRecord.id,
              leadDays: cfg.leadDays
            }, token);
            metaRecord.reminder.calendarEventId = calEvent.id;
            await updateMetaFileInDrive(metaRecord, token);
          } catch (calErr) {
            console.warn('Kalender-API Fallback aktiv:', calErr);
          }
        }
      }

      await saveDocument(metaRecord);
      resetScanState();
      switchView('archive');
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Speichern & Termin anlegen';
    }
  });
}

function setupArchiveFilters() {
  document.getElementById('search-input').addEventListener('input', refreshArchiveAndTasks);
  document.getElementById('archive-category-filter').addEventListener('change', refreshArchiveAndTasks);

  document.querySelectorAll('#filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filter-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilterChip = chip.dataset.filter;
      refreshArchiveAndTasks();
    });
  });
}

async function refreshArchiveAndTasks() {
  const query = document.getElementById('search-input').value;
  const category = document.getElementById('archive-category-filter').value;
  const filteredDocs = await searchDocuments(query, activeFilterChip, category);
  const allDocs = await getAllDocuments();

  const openTasks = allDocs.filter(d => d.status === 'open' && (d.actionRequired || d.reminder));
  document.getElementById('open-tasks-count').textContent = `${openTasks.length} offene Aufgabe(n)`;
  document.getElementById('total-docs-count').textContent = `${allDocs.length} Dokumente im Archiv`;

  renderArchiveList(filteredDocs);
  renderTasksList(openTasks);
}

function renderArchiveList(docs) {
  const list = document.getElementById('archive-list');
  list.innerHTML = '';

  if (docs.length === 0) {
    list.innerHTML = '<p class="hint">Keine passenden Dokumente gefunden.</p>';
    return;
  }

  docs.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'doc-card';
    const amountStr = doc.financial?.amountTotal ? `${doc.financial.amountTotal.toFixed(2).replace('.', ',')} €` : '';
    const statusLabel = doc.status === 'open' ? 'Offen' : (doc.status === 'done' ? 'Erledigt' : 'Archiviert');

    card.innerHTML = `
      <div class="doc-card-header">
        <h3>${doc.title}</h3>
        <span class="badge ${doc.status}">${statusLabel}</span>
      </div>
      <div class="doc-meta">
        <strong>${doc.sender}</strong> · ${doc.docType} · ${doc.category} · ${doc.docDate || '-'} ${amountStr ? `· <strong>${amountStr}</strong>` : ''}
      </div>
      <p class="doc-summary">${doc.summary}</p>
    `;
    card.addEventListener('click', () => openDetailModal(doc));
    list.appendChild(card);
  });
}

function renderTasksList(tasks) {
  const list = document.getElementById('tasks-list');
  list.innerHTML = '';

  if (tasks.length === 0) {
    list.innerHTML = '<p class="hint">🎉 Keine offenen Fristen oder Rechnungen!</p>';
    return;
  }

  tasks.sort((a, b) => {
    const da = a.financial?.dueDate || a.reminder?.date || '9999-12-31';
    const db = b.financial?.dueDate || b.reminder?.date || '9999-12-31';
    return da.localeCompare(db);
  });

  tasks.forEach(doc => {
    const due = doc.financial?.dueDate || doc.reminder?.date;
    const daysLeft = due ? Math.ceil((new Date(due) - new Date()) / 86400000) : null;
    const isOverdue = daysLeft !== null && daysLeft < 0;

    const card = document.createElement('div');
    card.className = 'doc-card';
    card.innerHTML = `
      <div class="doc-card-header">
        <h3>${doc.sender}: ${doc.title}</h3>
        <span class="badge ${isOverdue ? 'overdue' : 'open'}">
          ${daysLeft === null ? 'Offen' : (isOverdue ? `Überfällig (${Math.abs(daysLeft)} T.)` : `Noch ${daysLeft} Tag(e)`)}
        </span>
      </div>
      <div class="doc-meta">
        Fälligkeit: <strong>${due || '-'}</strong>
        ${doc.financial?.amountTotal ? ` · Betrag: <strong>${doc.financial.amountTotal.toFixed(2).replace('.', ',')} €</strong>` : ''}
      </div>
      <div style="margin-top:0.5rem;">
        <button type="button" class="btn-small btn-primary" data-complete="${doc.id}">✓ Als erledigt abhaken</button>
      </div>
    `;
    card.querySelector('[data-complete]').addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleDocStatus(doc);
    });
    card.addEventListener('click', () => openDetailModal(doc));
    list.appendChild(card);
  });
}

async function toggleDocStatus(doc) {
  doc.status = doc.status === 'open' ? 'done' : 'open';
  if (doc.reminder) doc.reminder.completed = doc.status === 'done';
  await saveDocument(doc);

  const token = authManager ? await authManager.getValidToken() : null;
  if (token) {
    await updateMetaFileInDrive(doc, token).catch(() => {});
    if (doc.status === 'done' && doc.reminder?.calendarEventId) {
      await markCalendarEventDone(doc.reminder.calendarEventId, doc.reminder.title, token).catch(() => {});
    }
  }
  refreshArchiveAndTasks();
}

function setupDetailModal() {
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('doc-detail-modal').classList.add('hidden');
  });

  document.getElementById('btn-toggle-status').addEventListener('click', async () => {
    if (!selectedDocForModal) return;
    await toggleDocStatus(selectedDocForModal);
    document.getElementById('doc-detail-modal').classList.add('hidden');
  });

  document.getElementById('btn-delete-doc').addEventListener('click', async () => {
    if (!selectedDocForModal) return;
    if (!confirm(`Dokument „${selectedDocForModal.title}“ wirklich löschen?`)) return;

    const token = authManager ? await authManager.getValidToken() : null;
    if (token) {
      await deleteDriveFile(selectedDocForModal.drive?.pdfFileId, token).catch(() => {});
      await deleteDriveFile(selectedDocForModal.drive?.metaFileId, token).catch(() => {});
      if (selectedDocForModal.reminder?.calendarEventId) {
        await deleteCalendarEvent(selectedDocForModal.reminder.calendarEventId, token).catch(() => {});
      }
    }
    await deleteDocumentLocal(selectedDocForModal.id);
    document.getElementById('doc-detail-modal').classList.add('hidden');
    refreshArchiveAndTasks();
  });
}

function openDetailModal(doc) {
  selectedDocForModal = doc;
  document.getElementById('detail-title').textContent = doc.title;

  const body = document.getElementById('detail-body');
  body.innerHTML = `
    <p><strong>Absender:</strong> ${doc.sender} (${doc.docType} · ${doc.category})</p>
    <p><strong>Datum:</strong> ${doc.docDate || '-'} | <strong>Akten-/Kundennr.:</strong> ${doc.referenceNo || '-'}</p>
    ${doc.financial?.amountTotal ? `<p><strong>Betrag:</strong> ${doc.financial.amountTotal.toFixed(2).replace('.', ',')} € | <strong>Fällig:</strong> ${doc.financial.dueDate || '-'}</p>` : ''}
    ${doc.financial?.iban ? `<p><strong>IBAN:</strong> <code>${doc.financial.iban}</code></p>` : ''}
    <p><strong>Zusammenfassung:</strong><br>${doc.summary}</p>
    <p><strong>Drive-Pfad:</strong> <code>${doc.drive?.folderPath || 'Lokal'}${doc.drive?.fileName || ''}</code></p>
    <details>
      <summary>Volltext anzeigen</summary>
      <pre style="white-space:pre-wrap; font-size:0.85rem;">${doc.fullText || '-'}</pre>
    </details>
  `;

  const driveLink = document.getElementById('detail-drive-link');
  driveLink.href = doc.drive?.webViewLink || '#';
  driveLink.classList.toggle('hidden', !doc.drive?.webViewLink);

  const calFallback = document.getElementById('detail-cal-fallback');
  const due = doc.financial?.dueDate || doc.reminder?.date;
  if (due) {
    calFallback.href = buildCalendarFallbackUrl({
      title: doc.reminder?.title || `${doc.sender}: ${doc.title}`,
      dueDate: due,
      driveUrl: doc.drive?.webViewLink
    });
    calFallback.classList.remove('hidden');
  } else {
    calFallback.classList.add('hidden');
  }

  document.getElementById('btn-toggle-status').textContent =
    doc.status === 'open' ? '✓ Als erledigt markieren' : 'Wieder als offen markieren';

  document.getElementById('doc-detail-modal').classList.remove('hidden');
}
                                                                                                                                                                                                           
