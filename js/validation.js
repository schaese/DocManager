export function validateIBAN(iban) {
  if (!iban) return false;
  const clean = iban.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (clean.length < 15 || clean.length > 34) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, char => char.charCodeAt(0) - 55);
  
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const block = remainder + numeric.slice(i, i + 7);
    remainder = parseInt(block, 10) % 97;
  }
  return remainder === 1;
}

export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function formatFilename(doc) {
  const dateStr = doc.document_date || new Date().toISOString().split('T')[0];
  const type = (doc.document_type || 'DOK').toUpperCase();
  const issuer = (doc.issuer || 'UNKNOWN').replace(/[^a-zA-Z0-9]/g, '_');
  return `${dateStr}_${type}_${issuer}.pdf`;
}