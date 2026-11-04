import { CATEGORIES, DOC_TYPES } from './validation.js';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    doc_date: { type: 'STRING', description: 'Dokumentdatum im Format YYYY-MM-DD' },
    sender: { type: 'STRING', description: 'Absender / Firma / Behörde' },
    category: { type: 'STRING', enum: CATEGORIES },
    doc_type: { type: 'STRING', enum: DOC_TYPES },
    title: { type: 'STRING', description: 'Kurzer sprechender Titel des Dokuments' },
    summary: { type: 'STRING', description: 'Zusammenfassung in 2-3 Sätzen auf Deutsch' },
    action_required: { type: 'BOOLEAN' },
    financial: {
      type: 'OBJECT',
      properties: {
        amount_total: { type: 'NUMBER' },
        currency: { type: 'STRING' },
        due_date: { type: 'STRING', description: 'YYYY-MM-DD' },
        iban: { type: 'STRING' },
        payment_reference: { type: 'STRING' }
      }
    },
    reference_no: { type: 'STRING', description: 'Kunden-, Vertrags- oder Aktenzeichen' },
    reminder: {
      type: 'OBJECT',
      properties: {
        needed: { type: 'BOOLEAN' },
        date: { type: 'STRING', description: 'YYYY-MM-DD' },
        type: { type: 'STRING' }
      }
    },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
    full_text_markdown: { type: 'STRING', description: 'Kompletter Text des Dokuments als Markdown' }
  },
  required: ['sender', 'category', 'doc_type', 'title', 'summary', 'action_required', 'full_text_markdown']
};

export async function analyzeDocumentWithGemini(partsInput, apiKey, modelName = 'gemini-2.5-flash') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const inlineParts = partsInput.map(item => {
    const [header, base64] = item.dataUrl.split(',');
    const mimeMatch = header.match(/data:(.*?);base64/);
    const mimeType = item.mimeType || (mimeMatch ? mimeMatch[1] : 'image/jpeg');
    return {
      inline_data: {
        mime_type: mimeType,
        data: base64 || item.dataUrl
      }
    };
  });

  const body = {
    contents: [
      {
        parts: [
          {
            text: 'Analysiere dieses deutschsprachige Dokument (Brief/Rechnung/Bescheid/Vertrag) und extrahiere alle Felder präzise gemäß JSON-Schema. Gib Datumsangaben immer als YYYY-MM-DD aus.'
          },
          ...inlineParts
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1
    }
  };

  let lastError = null;
  // FA-302: Bis zu 2 automatische Wiederholungen bei Fehlern oder 429
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.status === 429) {
        throw new Error('Gemini-Kontingent erschöpft (Fehler 429). Bitte kurz warten oder manuell erfassen.');
      }
      if (!res.ok) {
        throw new Error(`Gemini API Fehler (${res.status})`);
      }

      const result = await res.json();
      const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Leere Antwort von der Gemini-API.');
      return JSON.parse(rawText);
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}
