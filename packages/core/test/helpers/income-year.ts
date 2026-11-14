// The synthetic year of `fixtures/income/anno-sintetico.json`, written into a store as records.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordPath, recordSchemas } from '../../src/index';
import type { RecordKind } from '../../src/index';
import type { ConfirmIncomeInput } from '../../src/income-store';
import { MemoryStore } from './memory-store';

export interface IncomeYear {
  records: Partial<Record<RecordKind, { id: string }[]>>;
  expected: {
    initialAutomatic: { transactionId: string; forMonth: string }[];
    confirmations: ConfirmIncomeInput[];
    afterAutomatic: { transactionId: string; forMonth: string }[];
    afterProposals: string[];
    skipped: { transactionId: string; reason: string }[];
  };
}

export const year = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../fixtures/income/anno-sintetico.json', import.meta.url)),
    'utf8',
  ),
) as IncomeYear;

/** A store holding every record of the year, each checked against its schema. */
export async function yearStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const [kind, records] of Object.entries(year.records) as [RecordKind, { id: string }[]][]) {
    for (const record of records) {
      await store.writeJsonAtomic(recordPath(kind, record.id), recordSchemas[kind].parse(record));
    }
  }
  return store;
}

/** Every record file and journal file, with its exact text. */
export async function snapshot(store: MemoryStore): Promise<string[]> {
  const out: string[] = [];
  for (const dir of [...Object.keys(recordSchemas).map((k) => `_app/dati/${k}`), '_app/journal']) {
    for (const name of await store.list(dir)) {
      out.push(`${dir}/${name}\n${store.getRaw(`${dir}/${name}`) ?? ''}`);
    }
  }
  return out;
}

export const clock = () => '2026-11-14T09:00:00.000Z';

export function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
