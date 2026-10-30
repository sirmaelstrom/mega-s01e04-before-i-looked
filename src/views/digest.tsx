import type { DigestRow, Night } from '../digest/types.js';

const MARK = '⚑';
const dash = (v: string | null) => v ?? '—';

// A row is marked when it retried 3+ times or ever failed. The mark is text, not just colour,
// so a screenshot, a slow reader and an agent fetching the HTML all see it.
function Row({ row }: { row: DigestRow }) {
  const heavyRetries = row.retries >= 3;
  const failed = row.fails > 0;
  return (
    <tr class={heavyRetries || failed ? 'warn' : undefined}>
      <td>{row.job}</td>
      <td>{dash(row.owner)}</td>
      <td>{row.runs}</td>
      <td>{heavyRetries ? `${row.retries} ${MARK}` : row.retries}</td>
      <td>{failed ? `${row.lastStatus} ${MARK}` : row.lastStatus}</td>
      <td>{dash(row.lastError)}</td>
      <td>{row.firstAt}</td>
      <td>{row.lastAt}</td>
    </tr>
  );
}

export function DigestPage({ night }: { night: Night }) {
  return (
    <>
      <h1>digest · {night.night}</h1>
      {night.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {night.rows.map((row) => (
              <Row row={row} />
            ))}
          </tbody>
        </table>
      )}
      {night.badLines > 0 && (
        <p class="mute">
          {night.badLines === 1 ? "1 line didn't parse" : `${night.badLines} lines didn't parse`}
        </p>
      )}
    </>
  );
}
