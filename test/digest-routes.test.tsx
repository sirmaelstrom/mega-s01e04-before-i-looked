import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight, type Night } from '../src/digest/index.js';

// Route tests for the digest page (plan.md § 2a) and JSON (§ 2b). runs/ is read-only, so every
// night here is written into a temp dir.
const dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: dir };
const app = createApp(config);

const write = (night: string, lines: string[]) => writeFileSync(join(dir, `${night}.jsonl`), lines.join('\n'));

// hono/jsx escapes the apostrophe in dynamic text as &#39;; decode it before matching prose.
const text = async (res: Response) => (await res.text()).replaceAll('&#39;', "'");

const NIGHT = '2026-10-28';
const FAIL_NIGHT = '2026-10-27';
const EMPTY = '2026-10-26';
const BAD_ONE = '2026-10-25';
const BAD_TWO = '2026-10-24';
const MISSING = '2026-01-01';

beforeAll(() => {
  write(NIGHT, [
    '{"at":"2026-10-28T02:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
    '{"at":"2026-10-28T01:00:00+01:00","job":"digest/render","status":"fail","owner":null,"error":"boom"}',
    '{"at":"2026-10-28T03:00:00+01:00","job":"notes/backup","status":"retry","owner":"ada"}',
  ]);
  write(FAIL_NIGHT, [
    '{"at":"2026-10-27T01:00:00+01:00","job":"notes/backup","status":"fail","owner":"ada","error":"quota exceeded"}',
  ]);
  write(EMPTY, []);
  const good = '{"at":"2026-10-25T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}';
  write(BAD_ONE, [good, '{"at":"2026-10-25T02:00:00+01:00","job":"lane/sy']);
  write(BAD_TWO, [good, '{"at":"2026-10-24T02:00:00+01:00","job":"lane/sy', '{"at":"2026-10-24T03:00:0']);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('digest page and JSON with rows', () => {
  const priorMarker = process.env.LANE_MARKER;
  beforeAll(() => {
    process.env.LANE_MARKER = 'DIGEST-MARKER';
  });
  afterAll(() => {
    if (priorMarker === undefined) delete process.env.LANE_MARKER;
    else process.env.LANE_MARKER = priorMarker;
  });

  it('page: 200, one table, one row per job, sorted by job, owner null as —', async () => {
    const res = await app.request(`/digest/${NIGHT}`);
    const html = await text(res);
    expect(res.status).toBe(200);
    expect(html).toContain('<table');
    expect(html).toContain('DIGEST-MARKER');
    for (const job of ['digest/render', 'lane/sync', 'notes/backup']) {
      expect(html.split(job).length - 1).toBe(1);
    }
    const rowFor = (job: string) => html.split('<tr').find((chunk) => chunk.includes(job)) ?? '';
    expect(rowFor('digest/render')).toContain('—');
    expect(rowFor('lane/sync')).toContain('rook');
  });

  it('JSON: 200, exactly readNight(dir, night)', async () => {
    const res = await app.request(`/api/digest/${NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body).toEqual(readNight(dir, NIGHT));
    expect(body.rows.map((r) => r.job)).toEqual(['digest/render', 'lane/sync', 'notes/backup']);
    expect(body.badLines).toBe(0);
  });

  it('page and JSON list the jobs in the same order', async () => {
    const html = await text(await app.request(`/digest/${NIGHT}`));
    const body = (await (await app.request(`/api/digest/${NIGHT}`)).json()) as Night;
    const positions = body.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe('digest routes for a night with no file', () => {
  it('page: 404', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no run log for ${MISSING}`);
  });

  it('JSON: 404 with the error body', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });
});

describe('digest routes for an empty night', () => {
  it('page: 200, "nothing ran", no table', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await text(res);
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('JSON: 200, rows []', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body).toEqual(readNight(dir, EMPTY));
    expect(body.rows).toEqual([]);
  });
});

describe('digest routes for a night with bad lines', () => {
  it('page: 200, says 1 line didn\'t parse (singular)', async () => {
    const res = await app.request(`/digest/${BAD_ONE}`);
    expect(res.status).toBe(200);
    expect(await text(res)).toContain("1 line didn't parse");
  });

  it('JSON: 200, badLines 1, exactly readNight(dir, night)', async () => {
    const res = await app.request(`/api/digest/${BAD_ONE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body).toEqual(readNight(dir, BAD_ONE));
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync']);
  });

  it('page: says N lines didn\'t parse (plural) for two bad lines', async () => {
    const res = await app.request(`/digest/${BAD_TWO}`);
    expect(await text(res)).toContain("2 lines didn't parse");
  });
});
