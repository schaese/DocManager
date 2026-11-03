export async function createCalendarEvent(title, dateStr, accessToken) {
  const event = {
    summary: title,
    start: { date: dateStr },
    end: { date: dateStr }
  };

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(event)
  });

  if (!res.ok) throw new Error('Google Calendar Event Creation Failed');
  return await res.json();
}