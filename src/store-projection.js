import { atomicWrite, sha256 } from './util.js';

export async function writeStoreProjection(
  path,
  notation,
  bytes,
  { directoryPrepared = false, write = atomicWrite } = {}
) {
  const digest = `${sha256(notation)}:${sha256(bytes)}`;
  const entries = [
    [path.replace(/\.lino$/u, '.links'), bytes],
    [`${path}.sha256`, digest],
  ];
  // Both projections follow the durable canonical commit. Drain both even on
  // failure so a writer lock cannot release while its sibling still writes.
  const results = await Promise.allSettled(
    entries.map(([destination, contents]) =>
      Promise.resolve().then(() =>
        write(destination, contents, { directoryPrepared })
      )
    )
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    throw failed.reason;
  }
}
