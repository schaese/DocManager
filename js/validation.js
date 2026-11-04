export const CATEGORIES = [
  'Wohnen & Energie',
  'Versicherung',
  'Steuern',
  'KFZ',
  'Gesundheit',
  'Bank & Finanzen',
  'Arbeit',
  'Familie',
  'Elektronik',
  'Sonstiges'
];

export const DOC_TYPES = [
  'Rechnung',
  'Vertrag',
  'Bescheid',
  'Information',
  'Beleg'
];

export function validateIBAN(iban) {
  if (!iban) return true; // Optional, wenn leer
  const clean = iban.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (clean.length < 15 || clean.length > 34) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, char => char.charCodeAt(0) - 55);

  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const block = String(remainder) + numeric.slice(i, i + 7);
    remainder = parseInt(block, 10) % 97;
  }
  return remainder === 1;
}

export function validateDocumentFields(data) {
  const errors = [];
  const warnings = [];

  // 1. IBAN-Prüfung (sperrt Speichern bei Fehler, FA-402 / Kap. 7.3)
  if (data.iban && !validateIBAN(data.iban)) {
    errors.push('Die eingegebene IBAN ist ungültig (Prüfsumme Mod 97 fehlgeschlagen).');
  }

  // 2. Betrags-Prüfung (Kap. 7.3: > 0 und < 1.000.000)
  if (data.amount !== null && data.amount !== '' && !Number.isNaN(Number(data.amount))) {
    const val = Number(data.amount);
    if (val <= 0 || val >= 1000000) {
      errors.push('Der Betrag muss größer als 0,00 € und kleiner als 1.000.000 € sein.');
    }
  }

  // 3. Datums-Prüfung (Kap. 7.3: nicht vor 1990, max. 1 Tag in der Zukunft)
  if (data.docDate) {
    const docTime = new Date(data.docDate).getTime();
    const minTime = new Date('1990-01-01').getTime();
    const maxTime = Date.now() + 86400000; // +1 Tag Toleranz
    if (docTime < minTime || docTime > maxTime) {
      warnings.push('Das Dokumentdatum liegt außerhalb des üblichen Bereichs (1990 bis heute).');
    }
    if (data.dueDate) {
      const dueTime = new Date(data.dueDate).getTime();
      if (dueTime < docTime) {
        errors.push('Das Fälligkeitsdatum darf nicht vor dem Dokumentdatum liegen.');
      }
    }
  }

  if (!data.sender || !data.sender.trim()) {
    errors.push('Bitte einen Absender angeben.');
  }
  if (!data.title || !data.title.trim()) {
    errors.push('Bitte einen Dokumenttitel angeben.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

export async function hashFile(fileOrBlob) {
  const buffer = await fileOrBlob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function sanitizeSegment(str) {
  return String(str || '')
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-');
}

export function formatCategoryFolder(category) {
  const valid = CATEGORIES.includes(category) ? category : 'Sonstiges';
  return valid
    .replace(/\s*&\s*/g, '_')
    .replace(/\s+/g, '_');
}

export function formatFilename(meta) {
  const dateStr = meta.docDate || new Date().toISOString().split('T')[0];
  const sender = sanitizeSegment(meta.sender || 'Unbekannt');
  const docType = sanitizeSegment(DOC_TYPES.includes(meta.docType) ? meta.docType : 'Information');

  let amountPart = '';
  const amountNum = meta.financial?.amountTotal;
  if (typeof amountNum === 'number' && amountNum > 0) {
    amountPart = `_${amountNum.toFixed(2).replace('.', '-')}EUR`;
  }

  let base = `${dateStr}_${sender}_${docType}${amountPart}`;
  if (base.length > 116) {
    base = base.slice(0, 116);
  }
  return `${base}.pdf`;
}
  
