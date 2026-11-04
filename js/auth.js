export class GoogleAuthManager {
  constructor(clientId, onAuthChange) {
    this.clientId = clientId;
    this.accessToken = null; // NFA-03: Nur im Arbeitsspeicher!
    this.expiresAt = 0;
    this.onAuthChange = onAuthChange;
    this.client = null;
  }

  initTokenClient() {
    if (!window.google?.accounts?.oauth2 || !this.clientId) return;
    this.client = window.google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.appdata',
        'https://www.googleapis.com/auth/calendar.events'
      ].join(' '),
      callback: (resp) => {
        if (resp.access_token) {
          this.accessToken = resp.access_token;
          const expiresInSec = Number(resp.expires_in) || 3599;
          this.expiresAt = Date.now() + (expiresInSec - 60) * 1000;
          if (this.onAuthChange) this.onAuthChange(true, this.accessToken);
        }
      }
    });
  }

  requestToken(prompt = '') {
    if (!this.client) this.initTokenClient();
    if (this.client) {
      this.client.requestAccessToken({ prompt });
    }
  }

  async getValidToken() {
    if (this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken;
    }
    if (!this.client) return null;
    // FA-106: Automatische Sitzungserneuerung
    return new Promise((resolve) => {
      const prevCallback = this.onAuthChange;
      this.onAuthChange = (ok, token) => {
        this.onAuthChange = prevCallback;
        if (prevCallback) prevCallback(ok, token);
        resolve(ok ? token : null);
      };
      this.client.requestAccessToken({ prompt: '' });
    });
  }

  logout() {
    this.accessToken = null;
    this.expiresAt = 0;
    if (this.onAuthChange) this.onAuthChange(false, null);
  }

  revoke() {
    if (this.accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(this.accessToken, () => {});
    }
    this.logout();
  }
}
