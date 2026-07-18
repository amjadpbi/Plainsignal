import { getTrademarkClient } from './client';
import { findTrademarkMatches, ngrams } from './matching';
import type { TrademarkCheckResult, TrademarkClient } from './types';

export interface CheckOptions {
  client?: TrademarkClient;
}

/**
 * Check a listing's title and tags against a real trademark register
 * (CLAUDE.md §4.6). Surfaces matches with the mark, its status, and its owner.
 *
 * It does NOT judge infringement — no model is asked whether a use is
 * infringing. Trademark rights are class-specific and doctrines like
 * descriptive and nominative fair use exist; that assessment is a lawyer's job.
 */
export async function checkTrademarkRisk(
  input: { title: string; tags?: string[] },
  opts: CheckOptions = {},
): Promise<TrademarkCheckResult> {
  const client = opts.client ?? getTrademarkClient();
  const title = (input.title ?? '').trim();
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

  if (!title && tags.length === 0) {
    throw new Error('Nothing to check — provide a title or tags.');
  }

  // Candidate terms: every 1–3 word window from the title plus each whole tag.
  // The client may over-return; matching.ts decides what actually matches.
  const terms = [...new Set([...ngrams(title, 3), ...tags])];

  const marks = await client.searchMarks(terms);
  const matches = findTrademarkMatches({ title, tags }, marks);

  const summary = {
    high: matches.filter((m) => m.riskLevel === 'high').length,
    medium: matches.filter((m) => m.riskLevel === 'medium').length,
    info: matches.filter((m) => m.riskLevel === 'info').length,
  };

  const isMock = client.source === 'mock';
  const notes: string[] = [];
  if (isMock) {
    notes.push(
      'MOCK MODE: checked against a small offline list of well-known marks, not the full USPTO register. ' +
        'Serial numbers shown are placeholders (MOCK-…), not real USPTO identifiers.',
    );
    notes.push(
      'No official keyless USPTO text-search API exists — TESS was retired in 2023, TSDR looks up known serial numbers behind an API key, and the Open Data Portal is bulk download behind a USPTO.gov account. Configure TRADEMARK_API_URL/KEY to go live.',
    );
  }
  notes.push(
    'A match is not a legal conclusion. Trademarks are registered per class of goods, and some uses are lawful. This is not legal advice.',
  );

  return {
    source: client.source,
    isMock,
    checked: { title, tags },
    matches,
    summary,
    notes,
  };
}
