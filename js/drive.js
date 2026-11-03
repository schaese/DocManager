export async function uploadToDrive(file, filename, accessToken) {
  const metadata = {
    name: filename,
    mimeType: 'application/pdf'
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body: form
  });

  if (!res.ok) throw new Error('Google Drive Upload Failed');
  const data = await res.json();
  return data.id; // Drive File ID
}