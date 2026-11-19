// The commands of the core (plan 24, R386): what `scripts/estratti.mjs` did after reading its
// options, reachable from the screens of the app through any `Store`.

/** Who writes, the clock and the id generator of a command (they live outside the core). */
export interface CommandContext {
  who: string;
  clock: () => string;
  newId: () => string;
}

/**
 * Thrown to stop a command with a status: `invalid` (input or a file's content not valid),
 * `rejected` or `already-imported`. `extra` goes into the output as is.
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
