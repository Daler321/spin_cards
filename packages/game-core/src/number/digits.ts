import { CARD_NUMBER_LENGTH } from '@spincards/shared';

export type Digits = number[];

export function toDigits(number: string): Digits {
  if (!new RegExp(`^\\d{${CARD_NUMBER_LENGTH}}$`).test(number)) {
    throw new RangeError('card number must be 16 digits');
  }
  return Array.from(number, Number);
}

export function fromDigits(digits: readonly number[]): string {
  return digits.join('');
}
