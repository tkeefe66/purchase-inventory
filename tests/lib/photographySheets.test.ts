import { describe, test, expect, vi } from 'vitest';
import {
  readAssignments,
  getActiveAssignment,
  readProgress,
} from '../../lib/photographySheets.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const ASSIGNMENT_HEADER = [
  'id',
  'date_issued',
  'date_submitted',
  'date_graded',
  'topic_id',
  'assignment_text',
  'rubric_json',
  'status',
  'submitted_photo_telegram_file_id',
  'camera',
  'lens',
  'settings_extracted',
  'ai_verdict',
  'ai_critique',
  'per_criterion_json',
  'retry_count',
  'user_notes',
  'skipped_reason',
];

const PROGRESS_HEADER = [
  'topic_id',
  'status',
  'last_activity_at',
  'assignments_passed',
  'assignments_failed',
  'theory_last_read_at',
];

type MockSheetOpts = {
  tab: 'assignments' | 'progress';
  dataRows?: (string | number)[][];
};

function makeRow(
  header: string[],
  values: Record<string, string | number>,
): (string | number)[] {
  return header.map((h) => values[h] ?? '');
}

function mockSheets(opts: MockSheetOpts) {
  const header = opts.tab === 'assignments' ? ASSIGNMENT_HEADER : PROGRESS_HEADER;
  const sheets = {
    spreadsheets: {
      values: {
        get: vi.fn().mockImplementation(
          async (req: { range: string }) => {
            if (req.range.includes('!1:1')) {
              return { data: { values: [header] } };
            }
            return {
              data: {
                values: opts.dataRows ?? [],
              },
            };
          },
        ),
        append: vi.fn().mockResolvedValue({
          data: { updates: { updatedRange: "'Photography Assignments'!A2:R2" } },
        }),
        batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
  return sheets;
}

// ---------------------------------------------------------------------------
// readAssignments
// ---------------------------------------------------------------------------

describe('readAssignments', () => {
  test('parses two data rows into AssignmentRow objects', async () => {
    const row1 = makeRow(ASSIGNMENT_HEADER, {
      id: 'assign-001',
      date_issued: '2026-05-01',
      topic_id: 'exposure-basics',
      status: 'passed',
      ai_verdict: 'pass',
      retry_count: '2',
      assignment_text: 'Shoot in manual mode',
      rubric_json: '{"sharpness":true}',
      ai_critique: 'Good work',
    });
    const row2 = makeRow(ASSIGNMENT_HEADER, {
      id: 'assign-002',
      date_issued: '2026-05-10',
      topic_id: 'composition',
      status: 'active',
      ai_verdict: '',
      retry_count: '0',
    });

    const sheets = mockSheets({ tab: 'assignments', dataRows: [row1, row2] });
    const result = await readAssignments(sheets as never, 'sid');

    expect(result).toHaveLength(2);

    const first = result[0]!;
    expect(first.rowIndex).toBe(2);
    expect(first.id).toBe('assign-001');
    expect(first.dateIssued).toBe('2026-05-01');
    expect(first.topicId).toBe('exposure-basics');
    expect(first.status).toBe('passed');
    expect(first.aiVerdict).toBe('pass');
    expect(first.retryCount).toBe(2);
    expect(first.assignmentText).toBe('Shoot in manual mode');
    expect(first.rubricJson).toBe('{"sharpness":true}');
    expect(first.aiCritique).toBe('Good work');

    const second = result[1]!;
    expect(second.rowIndex).toBe(3);
    expect(second.id).toBe('assign-002');
    expect(second.status).toBe('active');
    expect(second.aiVerdict).toBe('');
    expect(second.retryCount).toBe(0);
  });

  test('skips rows with empty id', async () => {
    const emptyRow = makeRow(ASSIGNMENT_HEADER, { id: '', topic_id: 'foo', status: 'active' });
    const validRow = makeRow(ASSIGNMENT_HEADER, { id: 'assign-003', status: 'proposed' });

    const sheets = mockSheets({ tab: 'assignments', dataRows: [emptyRow, validRow] });
    const result = await readAssignments(sheets as never, 'sid');

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('assign-003');
  });

  test('returns empty array when sheet has no data rows', async () => {
    const sheets = mockSheets({ tab: 'assignments', dataRows: [] });
    const result = await readAssignments(sheets as never, 'sid');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getActiveAssignment
// ---------------------------------------------------------------------------

describe('getActiveAssignment', () => {
  test('returns null when no active or submitted rows exist', async () => {
    const rows = [
      makeRow(ASSIGNMENT_HEADER, { id: 'a1', status: 'passed' }),
      makeRow(ASSIGNMENT_HEADER, { id: 'a2', status: 'skipped' }),
    ];
    const sheets = mockSheets({ tab: 'assignments', dataRows: rows });
    const result = await getActiveAssignment(sheets as never, 'sid');
    expect(result).toBeNull();
  });

  test('returns the single active row', async () => {
    const rows = [
      makeRow(ASSIGNMENT_HEADER, { id: 'a1', status: 'passed' }),
      makeRow(ASSIGNMENT_HEADER, { id: 'a2', status: 'active' }),
    ];
    const sheets = mockSheets({ tab: 'assignments', dataRows: rows });
    const result = await getActiveAssignment(sheets as never, 'sid');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('a2');
    expect(result!.status).toBe('active');
  });

  test('returns the single submitted row', async () => {
    const rows = [
      makeRow(ASSIGNMENT_HEADER, { id: 'a1', status: 'submitted' }),
      makeRow(ASSIGNMENT_HEADER, { id: 'a2', status: 'proposed' }),
    ];
    const sheets = mockSheets({ tab: 'assignments', dataRows: rows });
    const result = await getActiveAssignment(sheets as never, 'sid');
    expect(result!.id).toBe('a1');
  });

  test('throws when more than one active/submitted row exists', async () => {
    const rows = [
      makeRow(ASSIGNMENT_HEADER, { id: 'a1', status: 'active' }),
      makeRow(ASSIGNMENT_HEADER, { id: 'a2', status: 'submitted' }),
    ];
    const sheets = mockSheets({ tab: 'assignments', dataRows: rows });
    await expect(getActiveAssignment(sheets as never, 'sid')).rejects.toThrow(
      /data invariant violated/i,
    );
  });
});

// ---------------------------------------------------------------------------
// readProgress
// ---------------------------------------------------------------------------

describe('readProgress', () => {
  test('parses progress rows correctly', async () => {
    const row1 = makeRow(PROGRESS_HEADER, {
      topic_id: 'exposure-basics',
      status: 'completed',
      last_activity_at: '2026-05-15T10:00:00Z',
      assignments_passed: '3',
      assignments_failed: '1',
      theory_last_read_at: '2026-05-14T08:00:00Z',
    });
    const row2 = makeRow(PROGRESS_HEADER, {
      topic_id: 'composition',
      status: 'in-progress',
      last_activity_at: '2026-05-18T12:00:00Z',
      assignments_passed: '1',
      assignments_failed: '0',
    });

    const sheets = mockSheets({ tab: 'progress', dataRows: [row1, row2] });
    const result = await readProgress(sheets as never, 'sid');

    expect(result).toHaveLength(2);

    const first = result[0]!;
    expect(first.rowIndex).toBe(2);
    expect(first.topicId).toBe('exposure-basics');
    expect(first.status).toBe('completed');
    expect(first.lastActivityAt).toBe('2026-05-15T10:00:00Z');
    expect(first.assignmentsPassed).toBe(3);
    expect(first.assignmentsFailed).toBe(1);
    expect(first.theoryLastReadAt).toBe('2026-05-14T08:00:00Z');

    const second = result[1]!;
    expect(second.topicId).toBe('composition');
    expect(second.status).toBe('in-progress');
    expect(second.assignmentsPassed).toBe(1);
    expect(second.assignmentsFailed).toBe(0);
    expect(second.theoryLastReadAt).toBe('');
  });

  test('skips rows with empty topic_id', async () => {
    const rows = [
      makeRow(PROGRESS_HEADER, { topic_id: '', status: 'locked' }),
      makeRow(PROGRESS_HEADER, { topic_id: 'light', status: 'available' }),
    ];
    const sheets = mockSheets({ tab: 'progress', dataRows: rows });
    const result = await readProgress(sheets as never, 'sid');
    expect(result).toHaveLength(1);
    expect(result[0]!.topicId).toBe('light');
  });

  test('returns empty array when sheet has no data rows', async () => {
    const sheets = mockSheets({ tab: 'progress', dataRows: [] });
    const result = await readProgress(sheets as never, 'sid');
    expect(result).toHaveLength(0);
  });
});
