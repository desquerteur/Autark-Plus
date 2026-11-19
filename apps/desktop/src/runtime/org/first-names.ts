// B-047 (contract D9): agents are colleagues with human first names by default; the role says what they do.
// A hire without a name gets a free first name from FIRST_NAMES (org/hire.ts). A name given is taken as given
// (feedback 1b136d01, 19.11.2026: "Firmenberater" is a fine name when the person wants it).
// Owns: the name list and the pick. Never: decides roles or saves anything.

/** Short first names that read naturally in German and English (no famous or branded names). */
export const FIRST_NAMES: readonly string[] = [
  'Mara', 'Jonas', 'Ella', 'Felix', 'Nora', 'Leon', 'Clara', 'Paul', 'Lina', 'Theo', 'Ida', 'Noah',
  'Lea', 'Elias', 'Mila', 'Finn', 'Hanna', 'Jan', 'Emma', 'Luca', 'Sophie', 'Ben', 'Lotta', 'Max',
  'Greta', 'David', 'Romy', 'Tom', 'Frida', 'Samuel', 'Nina', 'Oskar', 'Ronja', 'Levi', 'Alma', 'Milan',
];

/** A stable start index for `seed` (the new agent's id), so the same hire picks the same name. */
function startOf(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % FIRST_NAMES.length;
}

/** The first name from the list nobody uses yet, starting at the seed's place; undefined when all are taken. */
export function freeFirstName(seed: string, taken: (name: string) => boolean): string | undefined {
  const start = startOf(seed);
  for (let step = 0; step < FIRST_NAMES.length; step++) {
    const name = FIRST_NAMES[(start + step) % FIRST_NAMES.length];
    if (!taken(name)) return name;
  }
  return undefined;
}
