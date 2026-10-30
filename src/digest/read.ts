import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunStatus, StatusCounts } from './types.js';

type Line = { at: string; instant: number; job: string; status: RunStatus; owner: string | null; error: string | null };

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
// ISO 8601 date-time with an explicit offset, so the instant never depends on the server's zone.
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const STATUSES: readonly string[] = ['ok', 'retry', 'fail'] satisfies RunStatus[];

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
  return digest(night, text);
};

export function digest(night: string, text: string): Night {
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  const byJob = new Map<string, Line[]>();
  let badLines = 0;

  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (!line) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const lines = byJob.get(line.job);
    if (lines) lines.push(line);
    else byJob.set(line.job, [line]);
  }

  const rows = [...byJob.values()].map(toRow).sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, badLines, counts };
}

function parseLine(raw: string): Line | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || !AT.test(at)) return null;
  const instant = Date.parse(at);
  if (!Number.isFinite(instant)) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (typeof status !== 'string' || !STATUSES.includes(status)) return null;
  if (owner !== undefined && owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && error !== null && typeof error !== 'string') return null;
  return { at, instant, job, status: status as RunStatus, owner: owner ?? null, error: error ?? null };
}

// `lines` is in file order and non-empty. A stable sort by instant keeps file order on ties,
// so the first element is the earliest line and the last element is the latest.
function toRow(lines: Line[]): DigestRow {
  const sorted = [...lines].sort((a, b) => a.instant - b.instant);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const withError = sorted.findLast((l) => l.error !== null);
  return {
    job: last.job,
    owner: last.owner,
    runs: lines.length,
    retries: lines.filter((l) => l.status === 'retry').length,
    fails: lines.filter((l) => l.status === 'fail').length,
    lastStatus: last.status,
    lastError: withError?.error ?? null,
    firstAt: first.at,
    lastAt: last.at,
  };
}
