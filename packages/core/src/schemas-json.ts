/**
 * JSON Schema files for the data model, generated from the Zod schemas in `model.ts`.
 *
 * The Python side validates what it writes against these files. They describe what is stored on
 * disk, so the schemas are generated from the input side (`io: 'input'`): amounts are integers and
 * dates strings, not the branded types they are parsed into. Anything the generator cannot express
 * throws instead of silently turning into an empty schema.
 */
import { z } from 'zod';
import { OperationSchema } from './journal';
import { WorkspaceSchema, recordSchemas } from './model';

/**
 * The JSON Schema of each record kind (keys of `recordSchemas`), of the workspace file (key
 * `workspace`) and of an operation of the journal (key `operation`). The key order is fixed, so
 * the output is stable.
 */
export function exportJsonSchemas(): Record<string, object> {
  const schemas: Record<string, z.ZodType> = {
    ...recordSchemas,
    workspace: WorkspaceSchema,
    operation: OperationSchema,
  };
  return Object.fromEntries(
    Object.entries(schemas).map(([kind, schema]) => [
      kind,
      z.toJSONSchema(schema, { io: 'input' }),
    ]),
  );
}

/** The text of a schema file: two-space indented JSON and a final newline. */
export function serializeJsonSchema(schema: object): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
