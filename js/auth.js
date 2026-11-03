export class GoogleAuthManager {
  constructor(clientId) {
    this.clientId = clientId;
    this.accessToken = localStorage.getItem('g_access_token') || null;
  }

  initTokenClient(callback) {
    if (window.google && window.google.accounts) {
      this.client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events',
        callback: (resp) => {
          if (resp.access_token) {
            this.accessToken = resp.access_token;
            localStorage.setItem('g_access_token', resp.access_token);
            if (callback) callback(resp.access_token);
          }
        }
      });
    }
  }

  requestToken() {
    if (this.client) {
      this.client.requestAccessToken();
    }
  }

  getToken() {
    return this.accessToken;
  }
}