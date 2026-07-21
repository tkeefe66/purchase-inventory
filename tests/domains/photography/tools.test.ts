import { describe, test, expect, vi } from 'vitest';
import { createTools, TOOL_SCHEMAS, SERVER_TOOLS, type ToolDeps } from '../../../domains/photography/tools.js';
import type { AssignmentRow, ProgressRow } from '../../../lib/photographySheets.js';

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    weather: {
      getForecast: vi.fn(async () => ({
        resolved: { name: 'Boulder, CO', lat: 40.0, lon: -105.27, timezone: 'America/Denver' },
        daily: [],
        hourlyTomorrow: [],
      })),
    },
    geocode: vi.fn(async (place: string) => ({ lat: 40.014, lon: -105.27, name: place })),
    getActiveAssignment: vi.fn(async () => null),
    readProgress: vi.fn(async () => []),
    expanderDeps: { anthropic: {} as never, inventoryText: '(no inventory in test)' },
    ...overrides,
  };
}

function progRow(topicId: string, status: ProgressRow['status']): ProgressRow {
  return {
    rowIndex: 1, topicId, status,
    lastActivityAt: '2026-05-19T15:00:00Z',
    assignmentsPassed: status === 'completed' ? 1 : 0,
    assignmentsFailed: 0,
    theoryLastReadAt: '',
  };
}

function activeRow(topicId: string): AssignmentRow {
  return {
    rowIndex: 5, id: 'asgn-1', dateIssued: '', dateSubmitted: '', dateGraded: '',
    topicId, assignmentText: 'Take photos.', rubricJson: '[]', status: 'active',
    submittedPhotoTelegramFileId: '', camera: '', lens: '', settingsExtracted: '',
    aiVerdict: '', aiCritique: '', perCriterionJson: '', retryCount: 0,
    userNotes: '', skippedReason: '',
  };
}

describe('TOOL_SCHEMAS + SERVER_TOOLS', () => {
  test('TOOL_SCHEMAS includes all photography-specific tools', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'get_forecast', 'lookup_trail', 'search_trails_nearby',
      'get_sun_times', 'get_active_assignment', 'list_topics', 'get_topic_theory',
    ]));
  });

  test('SERVER_TOOLS includes web_search with photography-relevant domains', () => {
    const ws = SERVER_TOOLS.find((t) => t.name === 'web_search');
    expect(ws).toBeDefined();
    expect(ws?.allowed_domains).toEqual(expect.arrayContaining([
      'dpreview.com', 'sigmaphoto.com', 'epson.com', 'helpx.adobe.com',
    ]));
  });

  test('web_search allowed_domains has no duplicates (Anthropic 400s on dups)', () => {
    const ws = SERVER_TOOLS.find((t) => t.name === 'web_search');
    const domains = ws?.allowed_domains ?? [];
    const dups = domains.filter((d, i) => domains.indexOf(d) !== i);
    expect(dups, `duplicate domains in allowed list: ${dups.join(', ')}`).toEqual([]);
  });
});

describe('createTools — list_topics', () => {
  test('returns all 59 topics with status="locked"/"available" computed', async () => {
    const tools = createTools(makeDeps());
    const out = await tools.list_topics({});
    expect(out.total).toBe(59);
    // Tier-1 rootless are available; deep tier topics are locked
    const cameraOrientation = out.topics.find((t) => t.id === 'operating-camera.camera-orientation');
    expect(cameraOrientation?.status).toBe('available');
    const focusModes = out.topics.find((t) => t.id === 'operating-camera.focus-modes');
    expect(focusModes?.status).toBe('locked');
  });

  test('filters by branch', async () => {
    const tools = createTools(makeDeps());
    const out = await tools.list_topics({ branch: 'editing' });
    expect(out.total).toBe(12);
    for (const t of out.topics) expect(t.branch).toBe('editing');
  });

  test('filters by tier', async () => {
    const tools = createTools(makeDeps());
    const out = await tools.list_topics({ branch: 'seeing', tier: 3 });
    expect(out.total).toBe(5); // 5 genre recipes
    for (const t of out.topics) expect(t.tier).toBe(3);
  });

  test('filters by status (reflects progress state)', async () => {
    const tools = createTools(makeDeps({
      readProgress: vi.fn(async () => [
        progRow('operating-camera.exposure-triangle', 'completed'),
      ]),
    }));
    const completed = await tools.list_topics({ status: 'completed' });
    expect(completed.total).toBe(1);
    expect(completed.topics[0]!.id).toBe('operating-camera.exposure-triangle');
  });
});

describe('createTools — get_active_assignment', () => {
  test('returns null when none', async () => {
    const tools = createTools(makeDeps());
    const out = await tools.get_active_assignment();
    expect(out.active).toBeNull();
  });

  test('passes through the active row', async () => {
    const row = activeRow('operating-camera.aperture-priority');
    const tools = createTools(makeDeps({ getActiveAssignment: vi.fn(async () => row) }));
    const out = await tools.get_active_assignment();
    expect(out.active?.id).toBe('asgn-1');
    expect(out.active?.topicId).toBe('operating-camera.aperture-priority');
  });
});

describe('createTools — get_sun_times', () => {
  test('geocodes + returns sun times for a valid place', async () => {
    const tools = createTools(makeDeps());
    const out = await tools.get_sun_times({ location: 'Boulder, CO', date: '2026-06-21' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.location).toBe('Boulder, CO');
      expect(out.data.times.ok).toBe(true);
    }
  });

  test('returns error when geocoding fails', async () => {
    const tools = createTools(makeDeps({
      geocode: vi.fn(async () => { throw new Error('nominatim down'); }),
    }));
    const out = await tools.get_sun_times({ location: 'Bogusville' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('could_not_geocode');
  });

  test('rejects empty location', async () => {
    const tools = createTools(makeDeps());
    const out = await tools.get_sun_times({ location: '' });
    expect(out.ok).toBe(false);
  });
});

describe('createTools — get_topic_theory', () => {
  test('returns ok + lesson for a real topic', async () => {
    const tools = createTools(makeDeps({
      expanderDeps: {
        anthropic: {
          messages: { create: vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Expanded lesson body.' }] })) },
        } as never,
        inventoryText: '(no inventory)',
      },
    }));
    const out = await tools.get_topic_theory({ topic_id: 'operating-camera.exposure-triangle' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.name).toBe('Exposure Triangle');
      expect(out.lesson).toContain('Expanded lesson body');
    }
  });

  test('returns error for unknown topic', async () => {
    const tools = createTools(makeDeps());
    const out = await tools.get_topic_theory({ topic_id: 'does.not.exist' });
    expect(out.ok).toBe(false);
  });
});

describe('createTools — get_forecast', () => {
  test('passes location + days through to weather client', async () => {
    const getForecast = vi.fn(async () => ({
      resolved: { name: 'X', lat: 0, lon: 0, timezone: 'UTC' },
      daily: [], hourlyTomorrow: [],
    }));
    const tools = createTools(makeDeps({ weather: { getForecast } }));
    await tools.get_forecast({ location: 'Boulder, CO', days: 3 });
    expect(getForecast).toHaveBeenCalledWith({ location: 'Boulder, CO', days: 3 });
  });

  test('defaults days to 7 when omitted', async () => {
    const getForecast = vi.fn(async () => ({
      resolved: { name: 'X', lat: 0, lon: 0, timezone: 'UTC' },
      daily: [], hourlyTomorrow: [],
    }));
    const tools = createTools(makeDeps({ weather: { getForecast } }));
    await tools.get_forecast({ location: 'Boulder, CO' });
    expect(getForecast).toHaveBeenCalledWith({ location: 'Boulder, CO', days: 7 });
  });

  test('rejects empty location', async () => {
    const tools = createTools(makeDeps());
    const out = await tools.get_forecast({ location: '' });
    expect(out.ok).toBe(false);
  });
});
