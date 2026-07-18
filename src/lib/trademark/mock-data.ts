import type { TrademarkRecord } from './types';

/**
 * OFFLINE MOCK REGISTER.
 *
 * The mark texts and owners here are well-known public facts — these are
 * famous, actively registered US trademarks, which is what makes the module
 * demonstrably useful before a live data source is wired up.
 *
 * What is DELIBERATELY NOT real: serial and registration numbers. Every record
 * carries a `MOCK-` prefix and `source: 'mock'` so a fabricated identifier can
 * never be mistaken for a genuine USPTO record. We do not invent filing dates
 * or international classes either — inventing precise-looking legal identifiers
 * is exactly the failure mode CLAUDE.md §1 forbids.
 *
 * Replace this entirely by configuring a live source (see client.ts).
 */
// Declared before the register below: `mock()` is called during that array's
// initialization, so a `let` declared after it would be in the temporal dead
// zone (function declarations hoist; `let` bindings do not initialize).
let counter = 0;

export const MOCK_TRADEMARK_REGISTER: TrademarkRecord[] = [
  // --- Apparel / footwear ---
  mock('Nike', 'Nike, Inc.'),
  mock('Just Do It', 'Nike, Inc.'),
  mock('Adidas', 'adidas AG'),
  mock('Lululemon', 'lululemon athletica canada inc.'),
  mock('The North Face', 'The North Face Apparel Corp.'),
  mock('Patagonia', 'Patagonia, Inc.'),

  // --- Entertainment / characters ---
  mock('Disney', 'Disney Enterprises, Inc.'),
  mock('Mickey Mouse', 'Disney Enterprises, Inc.'),
  mock('Star Wars', 'Lucasfilm Entertainment Company Ltd. LLC'),
  mock('Marvel', 'Marvel Characters, Inc.'),
  mock('Harry Potter', 'Warner Bros. Entertainment Inc.'),
  mock('Pokemon', 'Nintendo of America Inc.'),
  mock('Barbie', 'Mattel, Inc.'),
  mock('Lego', 'LEGO Juris A/S'),

  // --- Tech / consumer ---
  mock('Apple', 'Apple Inc.'),
  mock('Google', 'Google LLC'),
  mock('Coca-Cola', 'The Coca-Cola Company'),
  mock('Starbucks', 'Starbucks Corporation'),
  mock('Tiffany', 'Tiffany and Company'),
  mock('Chanel', 'Chanel, Inc.'),
  mock('Louis Vuitton', 'Louis Vuitton Malletier'),

  // --- Phrases commonly (and riskily) printed on handmade goods ---
  mock('Super Bowl', 'NFL Properties LLC'),
  mock('Olympics', 'United States Olympic Committee'),
  mock('Bluey', 'BBC Studios Distribution Limited'),

  // --- A couple of DEAD marks, to exercise the info-only path ---
  mock('Blockbuster Video', 'Blockbuster L.L.C.', 'DEAD', 'CANCELLED'),
  mock('Zune', 'Microsoft Corporation', 'DEAD', 'ABANDONED'),
];

function mock(
  markText: string,
  owner: string,
  status: 'LIVE' | 'DEAD' = 'LIVE',
  statusText = 'REGISTERED',
): TrademarkRecord {
  counter += 1;
  return {
    mark: markText,
    status,
    statusText,
    // Intentionally not a real USPTO serial number.
    serialNumber: `MOCK-${String(counter).padStart(4, '0')}`,
    registrationNumber: null,
    owner,
    classes: [],
    source: 'mock',
  };
}
