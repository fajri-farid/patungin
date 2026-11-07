// Transaction contract fake: serial commits, reads-before-writes, rollback on failure.
// No Firebase credentials or network requests are used.
export function createFirestoreFake() {
  type Data = Record<string, unknown>;
  const documents = new Map<string, Data>();
  const ref = (path: string) => ({
    path,
    id: path.split("/").at(-1)!,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path),
    set: async (data: Data) => {
      documents.set(path, structuredClone(data));
    },
  });
  function snapshot(path: string) {
    const data = documents.get(path);
    return {
      exists: !!data,
      id: path.split("/").at(-1)!,
      ref: ref(path),
      data: () => (data ? structuredClone(data) : undefined),
    };
  }
  function collection(path: string) {
    return {
      path,
      doc: (id: string) => ref(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) =>
        query(path, field, value, Infinity, op),
      get: async () => query(path).get(),
    };
  }
  function query(
    path: string,
    field?: string,
    value?: unknown,
    maximum = Infinity,
    op = "==",
    conditions: Array<{ field: string; op: string; value: unknown }> = [],
  ) {
    const filters = field ? [...conditions, { field, op, value }] : conditions;
    return {
      query: true,
      path,
      field,
      value,
      maximum,
      limit: (n: number) => query(path, undefined, undefined, n, "==", filters),
      orderBy: () => query(path, undefined, undefined, maximum, "==", filters),
      where: (field: string, op: string, value: unknown) =>
        query(path, field, value, maximum, op, filters),
      get: async () => {
        const docs = [...documents]
          .filter(
            ([key, data]) =>
              key.slice(0, key.lastIndexOf("/")) === path &&
              filters.every(({ field, op, value }) =>
                op === "<=" ? String(data[field]) <= String(value) :
                op === "in" ? (value as unknown[]).includes(data[field]) : data[field] === value),
          )
          .slice(0, maximum)
          .map(([key]) => snapshot(key));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }
  let queue: Promise<unknown> = Promise.resolve();
  const firestore = {
    collection,
    runTransaction: async <T>(
      callback: (tx: unknown) => Promise<T>,
    ): Promise<T> => {
      const run = queue.then(async () => {
        const writes: Array<() => void> = [];
        const transaction = {
          get: async (
            reference: ReturnType<typeof ref> | ReturnType<typeof query>,
          ) => {
            if (writes.length)
              throw new Error("Firestore requires reads before writes");
            return "query" in reference
              ? reference.get()
              : snapshot(reference.path);
          },
          set: (reference: ReturnType<typeof ref>, data: Data) => {
            validate(data);
            writes.push(() =>
              documents.set(reference.path, structuredClone(data)),
            );
          },
          update: (reference: ReturnType<typeof ref>, data: Data) => {
            validate(data);
            writes.push(() =>
              documents.set(reference.path, {
                ...documents.get(reference.path),
                ...structuredClone(data),
              }),
            );
          },
          delete: (reference: ReturnType<typeof ref>) =>
            writes.push(() => documents.delete(reference.path)),
        };
        const result = await callback(transaction);
        writes.forEach((write) => write());
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    batch: () => {
      const refs: string[] = [];
      return {
        delete: (reference: { path: string }) => refs.push(reference.path),
        commit: async () => {
          refs.forEach((path) => documents.delete(path));
        },
      };
    },
  };
  function validate(value: unknown) {
    if (value === undefined)
      throw new Error("Firestore cannot store undefined");
    if (value && typeof value === "object" && !(value instanceof Date))
      Object.values(value).forEach(validate);
  }
  return { documents, firestore };
}
