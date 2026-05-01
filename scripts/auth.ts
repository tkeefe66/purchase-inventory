import 'dotenv/config';
import { google } from 'googleapis';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
];

const PORT = 3000;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('✗ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
    console.error('  Fill those in first, then re-run `npm run auth`.');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('Starting local OAuth callback server on', REDIRECT_URI);
  console.log('Opening your browser to grant access...');
  console.log();
  console.log('If the browser does not open automatically, copy this URL and paste it manually:');
  console.log(authUrl);
  console.log();

  const code = await captureAuthCode(authUrl);

  console.log('✓ Received authorization code, exchanging for tokens...');

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error('✗ Google did not return a refresh token.');
    console.error('  This usually means you have already granted access and Google reused the prior grant.');
    console.error('  Fix:');
    console.error('    1. Visit https://myaccount.google.com/permissions');
    console.error('    2. Find this OAuth app and click "Remove access"');
    console.error('    3. Re-run `npm run auth`');
    process.exit(1);
  }

  oauth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const labelsResp = await gmail.users.labels.list({ userId: 'me' });
  const labelCount = labelsResp.data.labels?.length ?? 0;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  let sheetTitle = '(GOOGLE_SHEET_ID not set — skipped)';
  if (sheetId) {
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title' });
    sheetTitle = meta.data.properties?.title ?? '(unknown title)';
  }

  writeRefreshTokenToEnv(tokens.refresh_token);

  console.log();
  console.log('✓ Refresh token written to .env (line GOOGLE_REFRESH_TOKEN=)');
  console.log(`✓ Gmail OK — found ${labelCount} labels for ${process.env.GMAIL_USER ?? '(unknown user)'}`);
  console.log(`✓ Sheets OK — sheet title: "${sheetTitle}"`);
  console.log();
  console.log('You are authenticated. Next: `npm run bootstrap-sheet` (Task 0.4).');
}

function captureAuthCode(authUrl: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', REDIRECT_URI);
        const error = url.searchParams.get('error');
        const code = url.searchParams.get('code');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body style="font-family:sans-serif;padding:2rem"><h1>Authorization failed</h1><p>${escapeHtml(error)}</p><p>You can close this tab.</p></body></html>`);
          server.close();
          rejectPromise(new Error(`OAuth error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body style="font-family:sans-serif;padding:2rem"><h1>✓ Authorization successful</h1><p>You can close this tab and return to the terminal.</p></body></html>');
          server.close();
          resolvePromise(code);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      } catch (err) {
        server.close();
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.on('error', rejectPromise);

    server.listen(PORT, '127.0.0.1', () => {
      tryOpenBrowser(authUrl);
    });
  });
}

function tryOpenBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? `open "${url}"` :
    platform === 'win32' ? `start "" "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.warn('(Could not auto-open browser — copy the URL above into your browser manually.)');
    }
  });
}

function writeRefreshTokenToEnv(refreshToken: string): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    throw new Error(`.env not found at ${envPath} — cannot persist refresh token.`);
  }
  const original = readFileSync(envPath, 'utf-8');
  const lines = original.split('\n');
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith('GOOGLE_REFRESH_TOKEN=')) {
      found = true;
      return `GOOGLE_REFRESH_TOKEN=${refreshToken}`;
    }
    return line;
  });
  if (!found) {
    updated.push(`GOOGLE_REFRESH_TOKEN=${refreshToken}`);
  }
  writeFileSync(envPath, updated.join('\n'));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

main().catch((err: unknown) => {
  console.error('✗ Auth flow failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
