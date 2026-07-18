/**
 * Pull an Etsy listing id out of user input — either a bare numeric id or a
 * listing URL pasted from the browser. Returns null when neither is present.
 */
export function extractListingId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  // e.g. https://www.etsy.com/listing/1234567890/handmade-linen-apron
  const match = trimmed.match(/listing\/(\d+)/i);
  return match ? match[1] : null;
}
