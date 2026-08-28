'use strict';

const { mergeVariables, substitute } = require('../src/templates');

describe('mergeVariables', () => {
  it('merges multiple maps, uppercasing keys and skipping null/undefined', () => {
    const result = mergeVariables({ a: '1' }, { b: undefined, c: null, d: 2 });
    expect(result).toEqual({ A: '1', D: '2' });
  });

  it('JSON.stringifies non-string values', () => {
    const result = mergeVariables({ list: [1, 2] });
    expect(result).toEqual({ LIST: '[1,2]' });
  });
});

describe('substitute', () => {
  it('replaces {{KEY}} placeholders case-insensitively', () => {
    expect(substitute('Hello {{name}}', { NAME: 'World' })).toBe('Hello World');
  });

  it('replaces unknown placeholders with an empty string', () => {
    expect(substitute('{{UNKNOWN}}', {})).toBe('');
  });

  it('returns an empty string for a falsy template', () => {
    expect(substitute('', { A: 'b' })).toBe('');
    expect(substitute(undefined, { A: 'b' })).toBe('');
  });

  it('HTML-escapes substituted values, except for PLAYGROUND_BUTTON', () => {
    expect(substitute('{{X}}', { X: `<a>&"'` })).toBe('&lt;a&gt;&amp;&quot;&#039;');
    expect(substitute('{{PLAYGROUND_BUTTON}}', { PLAYGROUND_BUTTON: '<a>raw</a>' })).toBe('<a>raw</a>');
  });
});
