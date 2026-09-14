/**
 * POSIX shell single-quote escaping: safe interpolation into sh -c scripts and
 * into commands prepared for the Console. Lives in shared/ because both the
 * Hidden Runner and the profile resolver (issue #90) build the same quoted
 * install commands; the renderer only ever displays the result.
 */
export function shellQuote(value: string): string {
  if (value.length === 0) return "''"
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Quote a list of values as separate shell words. */
export function shellQuoteAll(values: string[]): string {
  return values.map(shellQuote).join(' ')
}
