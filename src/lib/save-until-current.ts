/** A successful older snapshot must not allow navigation past newer edits. */
export async function saveUntilCurrent<T>(options: {
  sequence: () => number;
  save: () => Promise<T | null>;
  accept: (result: T, current: boolean) => void;
}): Promise<T | null> {
  while (true) {
    const sequence = options.sequence();
    const result = await options.save();
    if (result === null) return null;
    const current = sequence === options.sequence();
    options.accept(result, current);
    if (current) return result;
  }
}
