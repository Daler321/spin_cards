import { DEFAULT_GAME_CONFIG, type PatternId } from '@spincards/shared';
import { describe, expect, it } from 'vitest';
import { findPatterns, passesLuhn } from '../src/index.js';
import { config, digitsOf } from './helpers.js';

const table = DEFAULT_GAME_CONFIG.patterns.byId;
const find = (number: string) =>
  findPatterns(digitsOf(number), table).map((p) => `${p.id}@${p.start}`);

describe('findPatterns', () => {
  it.each<[string, string, string[]]>([
    ['no pattern', '9135 2468 0246 8135', []],
    ['quad', '9000 1111 2020 3581', ['quad@4']],
    ['quad in the first block', '9999 1203 5813 2468', ['quad@0']],
    ['quads in every block', '9999 1111 2222 3333', ['quad@0', 'quad@4', 'quad@8', 'quad@12']],
    ['radar', '9182 4334 5605 2468', ['radar@4']],
    ['radar in the first block', '9009 1528 3069 5274', ['radar@0']],
    ['ascending block ladder', '9147 1234 8080 5296', ['block_ladder@4']],
    ['descending block ladder from the leading 9', '9876 0352 4141 7290', ['block_ladder@0']],
    ['long ladder 1-8 across blocks', '9512 3456 7840 3388', ['long_ladder_8@2']],
    ['descending long ladder 8-1', '9087 6543 2195 0420', ['long_ladder_8@2']],
    ['long ladder 0-8 (length 9)', '9012 3456 7801 5524', ['long_ladder_9@1']],
    ['long ladder 9-0 (length 10)', '9876 5432 1053 1586', ['long_ladder_10@0']],
    [
      'long ladder and a separate block ladder',
      '9345 6709 2345 0283',
      ['long_ladder_5@1', 'block_ladder@8'],
    ],
    ['two long ladders', '9123 4598 7654 3010', ['long_ladder_5@1', 'long_ladder_7@6']],
    [
      'ladders sharing a turning digit',
      '9012 3454 3210 7788',
      ['long_ladder_6@1', 'long_ladder_6@6'],
    ],
    ['tail 7777 beats the quad in the same block', '9135 2468 0246 7777', ['tail_7777@12']],
    ['tail 0001', '9135 2468 0246 0001', ['tail_0001@12']],
    ['tail 1337', '9135 2468 0246 1337', ['tail_1337@12']],
    ['tail 6666', '9135 2468 0246 6666', ['tail_6666@12']],
    ['tail 9999', '9135 2468 0246 9999', ['tail_9999@12']],
    ['full duplicate supersedes everything', '9999 9999 9999 9999', ['full_duplicate@0']],
    // D-148: the 9 is fixed, so 9 + 15 equal digits is a full duplicate too.
    ['9 + fifteen 5s', '9555 5555 5555 5555', ['full_duplicate@0']],
    ['9 + fifteen 0s', '9000 0000 0000 0000', ['full_duplicate@0']],
    ['one digit off is three quads', '9555 5555 5555 5556', ['quad@4', 'quad@8']],
  ])('%s: %s', (_, number, expected) => {
    expect(find(number)).toEqual(expected);
  });

  it('does not count a block ladder inside a long ladder again', () => {
    expect(find('9123 4567 0808 2580')).toEqual(['long_ladder_7@1']);
  });

  it('keeps the last block pattern when it is worth more than the tail', () => {
    const custom = config().patterns.byId;
    custom.quad.multBp = 99_999;
    const ids = findPatterns(digitsOf('9135 2468 0246 6666'), custom).map((p) => p.id);
    expect(ids).toEqual<PatternId[]>(['quad']);
  });
});

describe('passesLuhn', () => {
  it.each([
    ['4539 1488 0343 6467', true],
    ['4539 1488 0343 6468', false],
    ['9999 9999 9999 9999', false],
    // The only 9 + 15 equal digits that passes Luhn: it can never be issued.
    ['9777 7777 7777 7777', true],
    ['9555 5555 5555 5555', false],
  ])('%s -> %s', (number, valid) => {
    expect(passesLuhn(digitsOf(number))).toBe(valid);
  });
});

describe('toDigits', () => {
  it('rejects anything but 16 digits', () => {
    expect(() => digitsOf('9123 4567')).toThrow(RangeError);
    expect(() => digitsOf('9123 4567 89ab 1234')).toThrow(RangeError);
  });
});
