function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export async function createCalendarEvent({ title, dueDate, driveUrl, docId, leadDays = 3 }, accessToken) {
  const endDate = addDays(dueDate, 1); // Wichtig für Google Calendar Ganztagstermine!
  const event = {
    summary: title,
    description: `Automatisch angelegt vom KI-Dokumentenarchiv.\nOriginaldokument in Google Drive: ${driveUrl || 'Lokal gespeichert'}`,
    start: { date: dueDate },
    end: { date: endDate },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: leadDays * 24 * 60 },
        { method: 'popup', minutes: 9 * 60 }
      ]
    },
    extendedProperties: {
      private: { documentId: docId }
    }
  };

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(event)
  });

  if (!res.ok) throw new Error('Kalendereintrag konnte nicht erstellt werden.');
  return await res.json();
}

export async function markCalendarEventDone(eventId, oldTitle, accessToken) {
  if (!eventId || !accessToken) return;
  const newTitle = oldTitle.startsWith('✓ ') ? oldTitle : `✓ [ERLEDIGT] ${oldTitle}`;
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ summary: newTitle })
  });
}

export async function deleteCalendarEvent(eventId, accessToken) {
  if (!eventId || !accessToken) return;
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

// FA-702 & R-3: Rückfall-Link ohne API-Berechtigung
export function buildCalendarFallbackUrl({ title, dueDate, driveUrl }) {
  if (!dueDate) return '#';
  const start = dueDate.replace(/-/g, '');
  const end = addDays(dueDate, 1).replace(/-/g, '');
  const details = encodeURIComponent(`Dokument in Google Drive: ${driveUrl || ''}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&details=${details}`;
}
