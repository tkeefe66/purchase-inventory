import 'server-only';
import { unstable_cache } from 'next/cache';
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

// Tom is the only user; he hits the web UI between bot actions, so caching
// for 30s keeps navigation snappy while ensuring fresh data shows up shortly
// after he submits a photo or runs a slash command.
const CACHE_TTL_SECONDS = 30;

export const getPhotographyProgress = unstable_cache(
  async (): Promise<ProgressRow[]> => {
    try {
      return await readProgress(client(), process.env['GOOGLE_SHEET_ID']!);
    } catch {
      return [];
    }
  },
  ['photography-progress'],
  { revalidate: CACHE_TTL_SECONDS, tags: ['photography'] },
);

export const getPhotographyAssignments = unstable_cache(
  async (): Promise<AssignmentRow[]> => {
    try {
      return await readAssignments(client(), process.env['GOOGLE_SHEET_ID']!);
    } catch {
      return [];
    }
  },
  ['photography-assignments'],
  { revalidate: CACHE_TTL_SECONDS, tags: ['photography'] },
);
