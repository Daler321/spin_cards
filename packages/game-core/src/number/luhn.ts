/** Standard Luhn checksum. Game card numbers must NOT pass it. */
export function passesLuhn(digits: readonly number[]): boolean {
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
    let d = digits[i] ?? 0;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
