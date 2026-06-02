import { describe, it, expect } from 'vitest';
import {
  parseRules,
  matchFirst,
  renderReply,
  type KeywordRule,
} from '../src/lib/keywords.js';

describe('parseRules', () => {
  it('parses simple "keyword => reply" lines', () => {
    const rules = parseRules('hello => Hi there!\nbug => Please file an issue.');
    expect(rules).toEqual<KeywordRule[]>([
      { keyword: 'hello', reply: 'Hi there!' },
      { keyword: 'bug', reply: 'Please file an issue.' },
    ]);
  });

  it('ignores blank lines and comments', () => {
    const rules = parseRules('# a comment\n\nhello => Hi\n   \n# another');
    expect(rules).toEqual<KeywordRule[]>([{ keyword: 'hello', reply: 'Hi' }]);
  });

  it('skips malformed lines without a => separator', () => {
    const rules = parseRules('this has no separator\nvalid => yes');
    expect(rules).toEqual<KeywordRule[]>([{ keyword: 'valid', reply: 'yes' }]);
  });

  it('skips lines with an empty keyword or empty reply', () => {
    const rules = parseRules('=> orphan reply\nkeyword =>   \nok => good');
    expect(rules).toEqual<KeywordRule[]>([{ keyword: 'ok', reply: 'good' }]);
  });

  it('keeps the first occurrence of a duplicate keyword (case-insensitive)', () => {
    const rules = parseRules('Hello => first\nhello => second');
    expect(rules).toEqual<KeywordRule[]>([{ keyword: 'Hello', reply: 'first' }]);
  });

  it('preserves reply text that itself contains "=>"', () => {
    const rules = parseRules('arrow => use a => b syntax');
    expect(rules).toEqual<KeywordRule[]>([{ keyword: 'arrow', reply: 'use a => b syntax' }]);
  });
});

describe('matchFirst', () => {
  const rules: KeywordRule[] = [
    { keyword: 'help', reply: 'How can I help?' },
    { keyword: 'bug', reply: 'File an issue.' },
    { keyword: 'c++', reply: 'A fine language.' },
  ];

  it('matches a whole word, case-insensitively', () => {
    const result = matchFirst('I need HELP please', rules);
    expect(result.rule).toEqual(rules[0]);
    expect(result.matchedKeyword).toBe('help');
  });

  it('does not match a keyword embedded inside another word', () => {
    expect(matchFirst('this is helpful', rules).rule).toBeNull();
    expect(matchFirst('debugging is hard', rules).rule).toBeNull();
  });

  it('matches a keyword followed by punctuation', () => {
    expect(matchFirst('found a bug!', rules).rule).toEqual(rules[1]);
    expect(matchFirst('is this a bug?', rules).rule).toEqual(rules[1]);
  });

  it('matches keywords containing regex-special characters literally', () => {
    expect(matchFirst('I love c++ a lot', rules).matchedKeyword).toBe('c++');
    // Ensure the "++" is not treated as a quantifier (which would throw or mis-match).
    expect(matchFirst('just c here', rules).rule).toBeNull();
  });

  it('returns the first matching rule when several could match', () => {
    const result = matchFirst('help me with this bug', rules);
    expect(result.rule).toEqual(rules[0]);
  });

  it('returns no match for empty or non-matching text', () => {
    expect(matchFirst('', rules).rule).toBeNull();
    expect(matchFirst('nothing relevant here', rules).rule).toBeNull();
  });
});

describe('renderReply', () => {
  it('substitutes {{author}} and {{keyword}} tokens', () => {
    const out = renderReply('Hi u/{{author}}, you said {{keyword}}.', {
      author: 'alice',
      keyword: 'help',
    });
    expect(out).toBe('Hi u/alice, you said help.');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderReply('Hello {{ author }}', { author: 'bob' })).toBe('Hello bob');
  });

  it('replaces missing variables with an empty string', () => {
    expect(renderReply('Hi {{author}}', {})).toBe('Hi ');
  });

  it('leaves unknown tokens untouched', () => {
    expect(renderReply('Score: {{points}}', { author: 'x' })).toBe('Score: {{points}}');
  });

  it('substitutes the {{reply}} token so a template can wrap rule text', () => {
    const out = renderReply('u/{{author}}: {{reply}}', {
      author: 'alice',
      reply: 'See the FAQ.',
    });
    expect(out).toBe('u/alice: See the FAQ.');
  });
});
