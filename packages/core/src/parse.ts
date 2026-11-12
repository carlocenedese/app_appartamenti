/** Validation shared by the modules that write records. Internal: not exported by `index.ts`. */
import type { ZodType } from 'zod';

/** `schema.parse` with an error that names the fields at fault and leaves their values out. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Not a valid ${what} (${issues})`, { cause: parsed.error });
}
