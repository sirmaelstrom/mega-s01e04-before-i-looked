import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/index.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('reads 5 jobs, sorted by job, and counts the 1 bad line', () => {
    expect(night?.night).toBe('2026-10-28');
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('counts every line as a run, retries included', () => {
    expect(row('fixtures/refresh')).toMatchObject({ runs: 4, retries: 3, fails: 0, lastStatus: 'ok' });
    expect(row('lane/sync')).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok' });
  });

  it('last error is the latest line that has one, even if a later run was ok', () => {
    expect(row('fixtures/refresh')?.lastError).toBe('upstream 503');
    expect(row('lane/sync')?.lastError).toBe('lock held');
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', fails: 1, lastError: 'quota exceeded' });
    expect(row('rig/rotate-logs')?.lastError).toBeNull();
  });

  it('keeps a null owner', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok' });
  });

  it('keeps the offset from the log', () => {
    expect(row('lane/sync')).toMatchObject({
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });
});

describe('readNight on a temp runs dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  const write = (night: string, text: string) => writeFileSync(join(dir, `${night}.jsonl`), text);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null when the night has no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
    expect(readNight(join(dir, 'missing'), '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD, before touching the filesystem', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', '2026-01-01.jsonl'), '');
    for (const night of ['../2026-10-28', 'sub/2026-01-01', '2026-1-1', '', '2026-10-28.jsonl']) {
      expect(readNight(dir, night)).toBeNull();
    }
  });

  it('reads an empty file as a night with no rows', () => {
    write('2026-01-02', '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips blank lines (CRLF too) and counts JSON without a usable at/job/status as bad', () => {
    write(
      '2026-01-03',
      [
        '',
        '{"at":"2026-01-03T01:00:00+02:00","job":"a","status":"ok","owner":"x"}',
        '   ',
        '{"job":"a","status":"ok","owner":"x"}',
        '{"at":"2026-01-03T01:00:00","job":"a","status":"ok","owner":"x"}',
        '{"at":"2026-01-03T01:00:00+02:00","status":"ok","owner":"x"}',
        '{"at":"2026-01-03T01:00:00+02:00","job":"a","status":"done","owner":"x"}',
        '[1,2]',
        'null',
        '',
      ].join('\r\n'),
    );
    const night = readNight(dir, '2026-01-03');
    expect(night?.badLines).toBe(6);
    expect(night?.rows).toHaveLength(1);
    expect(night?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('orders by the at instant, not file position or string, and takes owner and status from the latest line', () => {
    write(
      '2026-01-04',
      [
        '{"at":"2026-01-04T03:00:00+01:00","job":"b","status":"ok","owner":"late"}', // 02:00Z, latest
        '{"at":"2026-01-04T01:00:00+01:00","job":"b","status":"fail","owner":"early","error":"boom"}', // 00:00Z, earliest
        '{"at":"2026-01-04T03:30:00+03:00","job":"b","status":"retry","owner":"mid"}', // 00:30Z, sorts last as a string
        '{"at":"2026-01-04T00:00:00Z","job":"a","status":"ok"}',
      ].join('\n'),
    );
    const night = readNight(dir, '2026-01-04');
    expect(night?.rows.map((r) => r.job)).toEqual(['a', 'b']);
    expect(night?.rows[0]).toMatchObject({ owner: null, lastError: null });
    expect(night?.rows[1]).toEqual({
      job: 'b',
      owner: 'late',
      runs: 3,
      retries: 1,
      fails: 1,
      lastStatus: 'ok',
      lastError: 'boom',
      firstAt: '2026-01-04T01:00:00+01:00',
      lastAt: '2026-01-04T03:00:00+01:00',
    });
  });
});
