import { describe, expect, it, vi } from 'vitest';
import {
  containsPhrase,
  findTrademarkMatches,
  fuzzyThreshold,
  levenshtein,
  matchFieldAgainstMarks,
  ngrams,
  normalize,
  riskFor,
  tokenize,
} from '@/lib/trademark/matching';
import { checkTrademarkRisk } from '@/lib/trademark/check';
import { HttpTrademarkClient, MockTrademarkClient } from '@/lib/trademark/client';
import type { TrademarkRecord } from '@/lib/trademark/types';

function mark(
  text: string,
  status: 'LIVE' | 'DEAD' = 'LIVE',
  owner = 'Someone',
): TrademarkRecord {
  return {
    mark: text,
    status,
    statusText: status === 'LIVE' ? 'REGISTERED' : 'CANCELLED',
    serialNumber: `MOCK-${text.length}`,
    registrationNumber: null,
    owner,
    classes: [],
    source: 'mock',
  };
}

describe('normalize', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalize('  Coca-Cola®  ')).toBe('coca cola');
    expect(normalize('JUST DO IT!')).toBe('just do it');
  });

  it('strips accents so accented text still matches', () => {
    expect(normalize('Pokémon')).toBe('pokemon');
    expect(normalize('Céline')).toBe('celine');
  });

  it('returns empty string for punctuation-only input', () => {
    expect(normalize('!!! ---')).toBe('');
    expect(tokenize('!!!')).toEqual([]);
  });
});

describe('ngrams', () => {
  it('produces 1..3 word windows', () => {
    const g = ngrams('red linen apron', 3);
    expect(g).toContain('red');
    expect(g).toContain('red linen');
    expect(g).toContain('red linen apron');
    expect(g).toContain('linen apron');
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('nike', 'nike')).toBe(0);
    expect(levenshtein('nike', 'nikee')).toBe(1);
    expect(levenshtein('adidas', 'addidas')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('fuzzyThreshold', () => {
  it('gives short marks zero tolerance to avoid false positives', () => {
    // "nike" vs "bike" is one edit but a completely different word.
    expect(fuzzyThreshold(4)).toBe(0);
    expect(fuzzyThreshold(7)).toBe(1);
    expect(fuzzyThreshold(15)).toBe(2);
  });
});

describe('containsPhrase', () => {
  it('matches on whole-word boundaries only', () => {
    expect(containsPhrase('handmade nike inspired socks', 'nike')).toBe(true);
    expect(containsPhrase('vintage star wars poster', 'star wars')).toBe(true);
  });

  it('does not match a mark buried inside a longer word', () => {
    // "apple" must not match inside "pineapple"
    expect(containsPhrase('pineapple candle', 'apple')).toBe(false);
    expect(containsPhrase('snikers bar', 'nike')).toBe(false);
  });
});

describe('riskFor', () => {
  it('rates exact and contains matches on live marks as high', () => {
    expect(riskFor('exact', mark('Nike'))).toBe('high');
    expect(riskFor('contains', mark('Nike'))).toBe('high');
  });

  it('rates fuzzy matches on live marks as medium', () => {
    expect(riskFor('fuzzy', mark('Lululemon'))).toBe('medium');
  });

  it('treats dead marks as info regardless of match strength', () => {
    expect(riskFor('exact', mark('Zune', 'DEAD'))).toBe('info');
  });
});

describe('matchFieldAgainstMarks', () => {
  const marks = [mark('Nike'), mark('Star Wars'), mark('Lululemon')];

  it('finds an exact whole-field match', () => {
    const m = matchFieldAgainstMarks('Nike', 'tag', marks);
    expect(m).toHaveLength(1);
    expect(m[0].matchType).toBe('exact');
    expect(m[0].riskLevel).toBe('high');
  });

  it('finds a multi-word mark inside a longer title', () => {
    const m = matchFieldAgainstMarks('vintage star wars t-shirt gift', 'title', marks);
    expect(m).toHaveLength(1);
    expect(m[0].record.mark).toBe('Star Wars');
    expect(m[0].matchType).toBe('contains');
  });

  it('catches a near-miss spelling of a longer mark', () => {
    const m = matchFieldAgainstMarks('lululemon leggings', 'title', marks);
    expect(m[0].record.mark).toBe('Lululemon');

    const misspelled = matchFieldAgainstMarks('lulullemon leggings', 'title', marks);
    expect(misspelled).toHaveLength(1);
    expect(misspelled[0].matchType).toBe('fuzzy');
    expect(misspelled[0].riskLevel).toBe('medium');
  });

  it('returns nothing for unrelated text', () => {
    expect(matchFieldAgainstMarks('handmade ceramic mug', 'title', marks)).toHaveLength(0);
  });

  it('skips marks shorter than the minimum length', () => {
    expect(matchFieldAgainstMarks('go big', 'title', [mark('Go')])).toHaveLength(0);
  });
});

describe('findTrademarkMatches', () => {
  const marks = [mark('Nike'), mark('Just Do It'), mark('Zune', 'DEAD')];

  it('reports each mark once, at its strongest match', () => {
    const matches = findTrademarkMatches(
      { title: 'Nike', tags: ['nike', 'nike gift', 'handmade'] },
      marks,
    );
    const nike = matches.filter((m) => m.record.mark === 'Nike');
    expect(nike).toHaveLength(1);
    expect(nike[0].matchType).toBe('exact');
  });

  it('sorts high risk before info', () => {
    const matches = findTrademarkMatches(
      { title: 'Zune inspired Nike poster', tags: [] },
      marks,
    );
    expect(matches[0].riskLevel).toBe('high');
    expect(matches[matches.length - 1].riskLevel).toBe('info');
  });

  it('finds marks in tags as well as the title', () => {
    const matches = findTrademarkMatches(
      { title: 'motivational wall art', tags: ['just do it'] },
      marks,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].field).toBe('tag');
  });

  it('returns nothing for a clean listing', () => {
    expect(
      findTrademarkMatches({ title: 'handmade linen apron', tags: ['kitchen gift'] }, marks),
    ).toHaveLength(0);
  });
});

describe('checkTrademarkRisk (mock register)', () => {
  it('FLAGS an obviously trademarked term', async () => {
    const result = await checkTrademarkRisk(
      { title: 'Nike', tags: [] },
      { client: new MockTrademarkClient() },
    );
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].record.mark).toBe('Nike');
    expect(result.matches[0].riskLevel).toBe('high');
    expect(result.summary.high).toBeGreaterThan(0);
  });

  it('FLAGS a trademark embedded in a realistic listing title', async () => {
    const result = await checkTrademarkRisk(
      { title: 'Handmade Disney inspired mug for kids', tags: ['mickey mouse'] },
      { client: new MockTrademarkClient() },
    );
    const found = result.matches.map((m) => m.record.mark);
    expect(found).toContain('Disney');
    expect(found).toContain('Mickey Mouse');
  });

  it('catches a MISSPELLED mark through the full pipeline', async () => {
    // Regression: candidate retrieval used to filter by exact token overlap,
    // so a misspelling never retrieved the mark and fuzzy matching could not
    // fire. Unit-testing the matcher directly hid this — check end to end.
    const result = await checkTrademarkRisk(
      { title: 'lulullemon style yoga leggings', tags: [] },
      { client: new MockTrademarkClient() },
    );
    expect(result.matches.map((m) => m.record.mark)).toContain('Lululemon');
    expect(result.summary.medium).toBeGreaterThan(0);
  });

  it('returns NO matches for a made-up nonsense term', async () => {
    const result = await checkTrademarkRisk(
      { title: 'zorblatt fnurgle wibbletron', tags: ['quixnar'] },
      { client: new MockTrademarkClient() },
    );
    expect(result.matches).toHaveLength(0);
    expect(result.summary).toEqual({ high: 0, medium: 0, info: 0 });
  });

  it('returns no matches for an ordinary handmade listing', async () => {
    const result = await checkTrademarkRisk(
      { title: 'Personalized linen apron, handmade kitchen gift', tags: ['linen apron'] },
      { client: new MockTrademarkClient() },
    );
    expect(result.matches).toHaveLength(0);
  });

  it('always attaches the not-legal-advice note', async () => {
    const result = await checkTrademarkRisk(
      { title: 'anything', tags: [] },
      { client: new MockTrademarkClient() },
    );
    expect(result.notes.some((n) => n.includes('not legal advice'))).toBe(true);
  });

  it('rejects an empty check', async () => {
    await expect(
      checkTrademarkRisk({ title: '', tags: [] }, { client: new MockTrademarkClient() }),
    ).rejects.toThrow(/provide a title or tags/i);
  });
});

describe('HttpTrademarkClient (live seam)', () => {
  function client(body: unknown, ok = true, status = 200) {
    const fetchFn = vi.fn(async () => ({
      ok,
      status,
      statusText: 'x',
      json: async () => body,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;
    return {
      instance: new HttpTrademarkClient({
        apiUrl: 'https://example.test/search',
        apiKey: 'k',
        fetchFn,
      }),
      fetchFn,
    };
  }

  it('normalizes an upstream payload into TrademarkRecords', async () => {
    const { instance } = client({
      results: [
        {
          mark: 'Nike',
          status: 'LIVE',
          status_text: 'REGISTERED',
          serial_number: 12345,
          owner: 'Nike, Inc.',
          classes: [25],
        },
      ],
    });
    const [rec] = await instance.searchMarks(['nike']);
    expect(rec).toMatchObject({
      mark: 'Nike',
      status: 'LIVE',
      serialNumber: '12345',
      owner: 'Nike, Inc.',
      source: 'live',
    });
  });

  it('maps assorted status wording onto LIVE/DEAD/UNKNOWN', async () => {
    const cases: Array<[string, string]> = [
      ['REGISTERED', 'LIVE'],
      ['live', 'LIVE'],
      ['ABANDONED', 'DEAD'],
      ['CANCELLED', 'DEAD'],
      ['expired', 'DEAD'],
      ['something else', 'UNKNOWN'],
    ];
    for (const [raw, expected] of cases) {
      const { instance } = client({ results: [{ mark: 'X', status: raw }] });
      const [rec] = await instance.searchMarks(['x']);
      expect(rec.status).toBe(expected);
    }
  });

  it('throws with the upstream status on a failed request', async () => {
    const { instance } = client({ error: 'nope' }, false, 401);
    await expect(instance.searchMarks(['nike'])).rejects.toThrow(/401/);
  });

  it('skips records with no mark text', async () => {
    const { instance } = client({ results: [{ status: 'LIVE' }, { mark: 'Ok', status: 'LIVE' }] });
    const recs = await instance.searchMarks(['x']);
    expect(recs).toHaveLength(1);
    expect(recs[0].mark).toBe('Ok');
  });
});
