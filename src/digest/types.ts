// The night's run log, read into one row per job (plan.md § 1).
// Source: runs/<night>.jsonl, one JSON object per line:
//   { "at": string, "job": string, "status": "ok" | "retry" | "fail", "owner": string | null, "error"?: string }

export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night. "Latest line" = the line with the latest `at` instant; ties go to the later
// line in the file. "Earliest line" likewise, ties to the earlier line.
export type DigestRow = {
  job: string;
  // From the latest line. `null` when the log says null or leaves it out; the view renders `—`.
  owner: string | null;
  // Every log line for this job, retries included.
  runs: number;
  // Lines with status `retry`.
  retries: number;
  // Lines with status `fail`, so a page can mark a job that failed even if a later run was ok.
  fails: number;
  // Status of the latest line.
  lastStatus: RunStatus;
  // `error` of the latest line that has one (it may be older than the latest line: a job that
  // retried on "upstream 503" and then went ok keeps "upstream 503"). `null` if no line had one;
  // the view renders `—`.
  lastError: string | null;
  // `at` of the earliest and latest line, exactly as written: offset kept, never converted to UTC.
  firstAt: string;
  lastAt: string;
};

// Line counts by status over the night's valid lines (the board's ok / retry / fail).
export type StatusCounts = Record<RunStatus, number>;

export type Night = {
  night: string; // YYYY-MM-DD
  // Sorted by job, plain string compare (not locale). Empty when the file has no valid lines:
  // the page renders "nothing ran".
  rows: DigestRow[];
  // Non-blank lines that are not JSON, or are JSON without a usable `at` (ISO 8601 with offset),
  // `job` (non-empty string) or `status`, or with an `owner` / `error` of the wrong type.
  // Counted, never thrown. Blank lines (a trailing newline, CRLF leftovers) are not lines.
  badLines: number;
  counts: StatusCounts;
};

// Reads `<runsDir>/<night>.jsonl`.
// - `null`: no file for that night, or `night` is not YYYY-MM-DD (checked before the filesystem
//   is touched). The route answers 404.
// - A `Night` with `rows: []`: the file exists but nothing valid ran.
// - Never throws for bad content; other filesystem errors (permissions, a directory in the
//   file's place) are real faults and do throw.
export type ReadNight = (runsDir: string, night: string) => Night | null;
