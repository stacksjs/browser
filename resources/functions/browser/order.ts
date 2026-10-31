/**
 * Sidebar order as strings that sort: a row moved between two others gets a
 * key between theirs, so a drag rewrites one row instead of renumbering the
 * list. Keys use base-62 digits and never end in the zero digit, which keeps
 * a key available between any two.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** A key that sorts after `before` and before `after`; `null` stands for either end of the list. */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after)
    throw new Error(`keyBetween: "${before}" must sort before "${after}"`)
  for (const key of [before, after]) {
    if (key !== null && (key === '' || key.endsWith(DIGITS[0]!) || [...key].some(digit => !DIGITS.includes(digit))))
      throw new Error(`keyBetween: "${key}" is not an order key`)
  }
  // The ends are where rows arrive most (new Today tabs go first), so a key there
  // steps from its neighbour rather than halving the gap, and stays short.
  if (before === null && after === null) return DIGITS[DIGITS.length >> 1]!
  if (after === null) return increment(before!)
  if (before === null) return decrement(after)
  return midpoint(before, after)
}

/** A key just after `key`: its first digit that can grow, grown, and the rest dropped. */
function increment(key: string): string {
  for (let index = 0; index < key.length; index++) {
    const digit = DIGITS.indexOf(key[index]!)
    if (digit < DIGITS.length - 1) return key.slice(0, index) + DIGITS[digit + 1]
  }
  return key + DIGITS[DIGITS.length >> 1]
}

/** A key just before `key`, never ending in the zero digit. */
function decrement(key: string): string {
  for (let index = 0; index < key.length; index++) {
    const digit = DIGITS.indexOf(key[index]!)
    if (digit >= 2) return key.slice(0, index) + DIGITS[digit - 1]
    // A shorter key sorts first: `a1` comes before `a1x`.
    if (digit === 1 && index < key.length - 1) return key.slice(0, index + 1)
    if (digit === 1) return `${key.slice(0, index)}${DIGITS[0]}${DIGITS[DIGITS.length - 1]}`
  }
  throw new Error(`decrement: "${key}" is not an order key`)
}

/** `count` keys in order between `before` and `after`, for rows added together (an import). */
export function keysBetween(before: string | null, after: string | null, count: number): string[] {
  if (count <= 0) return []
  if (count === 1) return [keyBetween(before, after)]
  const middle = keyBetween(before, after)
  const half = Math.floor(count / 2)
  return [...keysBetween(before, middle, half), middle, ...keysBetween(middle, after, count - half - 1)]
}

function midpoint(low: string, high: string | null): string {
  if (high !== null) {
    // A shared prefix stays; the keys differ after it.
    let shared = 0
    while ((low[shared] ?? DIGITS[0]) === high[shared]) shared++
    if (shared > 0) return high.slice(0, shared) + midpoint(low.slice(shared), high.slice(shared))
  }
  const lowDigit = low ? DIGITS.indexOf(low[0]!) : 0
  const highDigit = high !== null ? DIGITS.indexOf(high[0]!) : DIGITS.length
  if (highDigit - lowDigit > 1) return DIGITS[Math.round((lowDigit + highDigit) / 2)]!
  // Adjacent digits: keep the high key's first digit when it has more to give, else go one digit deeper.
  if (high !== null && high.length > 1) return high.slice(0, 1)
  return DIGITS[lowDigit]! + midpoint(low.slice(1), null)
}
