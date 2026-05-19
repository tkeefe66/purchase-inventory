import 'server-only';
import { createSheetsClient } from '../../lib/sheets.js';
import {
  readProgress,
  readAssignments,
  type ProgressRow,
  type AssignmentRow,
} from '../../lib/photographySheets.js';

function client() {
  return createSheetsClient({
    clientId: process.env['GOOGLE_CLIENT_ID']!,
    clientSecret: process.env['GOOGLE_CLIENT_SECRET']!,
    refreshToken: process.env['GOOGLE_REFRESH_TOKEN']!,
  });
}

export async function getPhotographyProgress(): Promise<ProgressRow[]> {
  try {
    return await readProgress(client(), process.env['GOOGLE_SHEET_ID']!);
  } catch {
    // Tab may not exist yet on fresh installs; render an empty progress state.
    return [];
  }
}

export async function getPhotographyAssignments(): Promise<AssignmentRow[]> {
  try {
    return await readAssignments(client(), process.env['GOOGLE_SHEET_ID']!);
  } catch {
    return [];
  }
}
