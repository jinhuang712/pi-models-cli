/** Wrong command line. Exit code 2. */
export class UsageError extends Error {}

/** The command ran and could not do its job; nothing was written. Exit code 1. */
export class FailError extends Error {}
