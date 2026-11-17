import { describe, expect, it } from 'vitest';
import { overrideProblem, textVariables } from '../src/texts.js';

describe('text overrides (D-134)', () => {
  it('knows the variables of a default text, ICU included', () => {
    expect(textVariables('Привет, {name}! Это {appName}')).toEqual(['name', 'appName']);
    expect(textVariables('{count, plural, one {# карта} other {# карт}} у {name}')).toEqual([
      'count',
      'name',
    ]);
  });

  it('allows plain placeholders of the default only', () => {
    expect(overrideProblem('Привет, {name}!', 'Здравствуй, {name}')).toBeNull();
    expect(overrideProblem('Привет, {name}!', 'Без имени')).toBeNull();
    expect(overrideProblem('Привет, {name}!', 'Привет, {nick}')).toMatch(/unknown/);
    expect(overrideProblem('{count, plural, other {#}}', '{count, plural, other {#}}')).toMatch(
      /plain/,
    );
    expect(overrideProblem('Привет', 'Привет {')).toMatch(/unbalanced/);
  });
});
