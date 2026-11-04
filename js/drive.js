import { formatCategoryFolder } from './validation.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';

async function findFolder(name, parentId, token) {
  const parentClause = parentId ? `'${parentId}' in parents and ` : '';
  const q = `${parentClause}mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
  const res = await fetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Drive-Ordnersuche fehlgeschlagen.');
  const data = await res.json();
  return data.files?.[0] || null;
}

async function createFolder(name, parentId, token) {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {})
  };
  const res = await fetch(`${DRIVE_API}?fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadata)
  });
  if (!res.ok) throw new Error(`Ordner "${name}" konnte nicht erstellt werden.`);
  return await res.json();
}

export async function ensureArchiveFolderHierarchy(year, category, token) {
  let root = await findFolder('DokumentenArchiv', null, token);
  if (!root) root = await createFolder('DokumentenArchiv', null, token);

  const yearStr = String(year || new Date().getFullYear());
  let yearFolder = await findFolder(yearStr, root.id, token);
  if (!yearFolder) yearFolder = await createFolder(yearStr, root.id, token);

  const catFolderName = formatCategoryFolder(category);
  let catFolder = await findFolder(catFolderName, yearFolder.id, token);
  if (!catFolder) catFolder = await createFolder(catFolderName, yearFolder.id, token);

  return {
    rootId: root.id,
    folderId: catFolder.id,
    folderPath: `/DokumentenArchiv/${yearStr}/${catFolderName}/`
  };
}

async function resolveUniqueFilename(baseFilename, folderId, token) {
  const q = `'${folderId}' in parents and name='${baseFilename}' and trashed=false`;
  const res = await fetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return baseFilename;
  const data = await res.json();
  if (!data.files?.length) return baseFilename;
  return baseFilename.replace(/\.pdf$/i, '_2.pdf'); // FA-502 Kollisions-Suffix
}

async function uploadMultipartFile(blob, filename, mimeType, folderId, token) {
  const metadata = { name: filename, mimeType, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch(DRIVE_UPLOAD, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  if (!res.ok) throw new Error(`Upload von ${filename} fehlgeschlagen.`);
  return await res.json();
}

export async function deleteDriveFile(fileId, token) {
  if (!fileId) return;
  await fetch(`${DRIVE_API}/${fileId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ trashed: true })
  });
}

// FA-504: Konsistente Speicherung (PDF -> .meta.json mit Rollback bei Fehler)
export async function saveDocumentToDrive(pdfBlob, metaRecord, token) {
  const year = (metaRecord.docDate || new Date().toISOString()).slice(0, 4);
  const { folderId, folderPath } = await ensureArchiveFolderHierarchy(year, metaRecord.category, token);
  const finalPdfName = await resolveUniqueFilename(metaRecord.drive.fileName, folderId, token);
  const finalMetaName = finalPdfName.replace(/\.pdf$/i, '.meta.json');

  let uploadedPdf = null;
  try {
    uploadedPdf = await uploadMultipartFile(pdfBlob, finalPdfName, 'application/pdf', folderId, token);

    metaRecord.drive = {
      pdfFileId: uploadedPdf.id,
      metaFileId: '',
      webViewLink: uploadedPdf.webViewLink || `https://drive.google.com/file/d/${uploadedPdf.id}/view`,
      folderPath,
      fileName: finalPdfName
    };

    const metaBlob = new Blob([JSON.stringify(metaRecord, null, 2)], { type: 'application/json' });
    const uploadedMeta = await uploadMultipartFile(metaBlob, finalMetaName, 'application/json', folderId, token);
    metaRecord.drive.metaFileId = uploadedMeta.id;

    return metaRecord;
  } catch (err) {
    // Rollback (TF-04): Verwaistes PDF wieder entfernen
    if (uploadedPdf?.id) {
      await deleteDriveFile(uploadedPdf.id, token).catch(() => {});
    }
    throw err;
  }
}

export async function updateMetaFileInDrive(metaRecord, token) {
  const metaId = metaRecord.drive?.metaFileId;
  if (!metaId) return;
  metaRecord.updatedAt = new Date().toISOString();
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${metaId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metaRecord, null, 2)
  });
}

// FA-801: Paralleler Index-Aufbau aus allen .meta.json Dateien (500 Docs < 60s)
export async function rebuildIndexFromDrive(token, onProgress) {
  const q = "name contains '.meta.json' and trashed=false";
  const res = await fetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&pageSize=1000&fields=files(id,name,modifiedTime)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Konnte Metadaten-Liste nicht aus Drive abrufen.');
  const { files = [] } = await res.json();

  const results = [];
  const concurrency = 8;
  let completed = 0;

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchDocs = await Promise.all(
      batch.map(async (f) => {
        const r = await fetch(`${DRIVE_API}/${f.id}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        completed++;
        if (onProgress) onProgress(completed, files.length);
        return r.ok ? await r.json() : null;
      })
    );
    results.push(...batchDocs.filter(Boolean));
  }
  return results;
}

// Kap. 6.4 & FA-104: Einstellungen im versteckten appDataFolder speichern
export async function saveSettingsToAppData(settings, token) {
  const q = "'appDataFolder' in parents and name='settings.json'";
  const listRes = await fetch(`${DRIVE_API}?spaces=appDataFolder&q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const listData = listRes.ok ? await listRes.json() : { files: [] };
  const existingId = listData.files?.[0]?.id;

  if (existingId) {
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  } else {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: 'settings.json', parents: ['appDataFolder'] })], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(settings)], { type: 'application/json' }));
    await fetch(DRIVE_UPLOAD, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
  }
}
