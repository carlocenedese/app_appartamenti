// The commands of the core (plan 24, R386): what `scripts/estratti.mjs` did after reading its
// options, reachable from the screens of the app through any `Store`.

/** Who writes, the clock and the id generator of a command (they live outside the core). */
export interface CommandContext {
  who: string;
  clock: () => string;
  newId: () => string;
}

/**
 * Thrown to stop a command with a status: `invalid` (arguments or a file not valid: exit 2 on the
 * command line), `rejected` or `already-imported` (exit 1). `extra` goes into the output as is.
 */
export class CommandStop extends Error {
  constructor(
    readonly status: 'invalid' | 'rejected' | 'already-imported',
    readonly reason: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(reason);
    this.name = 'CommandStop';
  }
}

/** A `CommandStop` with status `invalid`. */
export const invalidCommand = (reason: string, extra?: Record<string, unknown>): CommandStop =>
  new CommandStop('invalid', reason, extra);
