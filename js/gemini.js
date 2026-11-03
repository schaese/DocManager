export async function analyzeDocumentWithGemini(base64Data, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const prompt = `Analyze this document and extract structured JSON matching the following schema:
  {
    "document_type": "RECHNUNG | VERTRAG | BRIEF | SONSTIGES",
    "issuer": "Name of company/sender",
    "document_date": "YYYY-MM-DD",
    "amount": 123.45,
    "currency": "EUR",
    "payment_deadline": "YYYY-MM-DD",
    "iban": "IBAN string",
    "cancellation_deadline": "YYYY-MM-DD",
    "tags": ["tag1", "tag2"],
    "summary": "Brief summary"
  }
  Respond ONLY with raw valid JSON, no markdown backticks.`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: "application/pdf",
              data: base64Data.split(',')[1] || base64Data
            }
          }
        ]
      }
    ]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error('Gemini API request failed');
  const result = await res.json();
  const text = result.candidates[0].content.parts[0].text;
  return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
}