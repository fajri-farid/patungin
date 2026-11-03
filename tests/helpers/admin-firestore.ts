import { createFirestoreFake } from "./firestore";

export function createAdminFirestoreFake() {
  const base = createFirestoreFake();
  type Row = Record<string, unknown>;
  type Sort = { field: string; direction: string };
  type Filter = { field: string; op: string; value: unknown };
  const queries: Array<{ collection: string; maximum: number; filters: Filter[]; orders: Sort[]; fields: string[] | null; cursor: unknown[] | null; returned: number }> = [];
  const ownerBatches: number[] = [];
  const compare = (a: unknown, b: unknown) => a! < b! ? -1 : a! > b! ? 1 : 0;
  const fieldName = (field: unknown) => String(field);
  function query(path: string, filters: Filter[] = [], orders: Sort[] = [], maximum = Infinity, fields: string[] | null = null, cursor: unknown[] | null = null) {
    return {
      query: true, path,
      where: (field: unknown, op: string, value: unknown) => query(path, [...filters, { field: fieldName(field), op, value }], orders, maximum, fields, cursor),
      orderBy: (field: unknown, direction = "asc") => query(path, filters, [...orders, { field: fieldName(field), direction }], maximum, fields, cursor),
      limit: (n: number) => query(path, filters, orders, n, fields, cursor),
      select: (...selected: string[]) => query(path, filters, orders, maximum, selected, cursor),
      startAfter: (...values: unknown[]) => query(path, filters, orders, maximum, fields, values),
      get: async () => {
        const value = (id: string, row: Row, field: string) => field === "__name__" ? id : row[field];
        const rows = [...base.documents].filter(([key]) => key.slice(0, key.lastIndexOf("/")) === path)
          .map(([key, row]) => ({ key, id: key.split("/").at(-1)!, row }))
          .filter(({ id, row }) => filters.every(({ field, op, value: expected }) => {
            const actual = value(id, row, field);
            if (actual === undefined) return false;
            return op === "in" ? (expected as unknown[]).includes(actual) : op === "==" ? actual === expected : op === ">=" ? compare(actual, expected) >= 0 :
              op === "<=" ? compare(actual, expected) <= 0 : op === ">" ? compare(actual, expected) > 0 :
              op === "<" ? compare(actual, expected) < 0 : false;
          }))
          .filter(({ row }) => orders.every(({ field }) => field === "__name__" || row[field] !== undefined))
          .sort((a, b) => {
            for (const { field, direction } of orders) {
              const delta = compare(value(a.id, a.row, field), value(b.id, b.row, field));
              if (delta) return direction === "desc" ? -delta : delta;
            }
            return compare(a.id, b.id);
          })
          .filter(({ id, row }) => {
            if (!cursor) return true;
            for (let i = 0; i < orders.length; i++) {
              const delta = compare(value(id, row, orders[i].field), cursor[i]);
              if (delta) return (orders[i].direction === "desc" ? -delta : delta) > 0;
            }
            return false;
          }).slice(0, maximum);
        queries.push({ collection: path, maximum, filters, orders, fields, cursor, returned: rows.length });
        return { docs: rows.map(({ id, row }) => ({
          id, exists: true, ref: base.firestore.collection(path).doc(id),
          data: () => structuredClone(fields ? Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]])) : row),
        })), size: rows.length, empty: rows.length === 0 };
      },
    };
  }
  const firestore = {
    ...base.firestore,
    collection: (path: string) => ({ ...base.firestore.collection(path), ...query(path) }),
    getAll: async (...args: Array<{ path: string; get?: () => Promise<unknown> } | { fieldMask: string[] }>) => {
      const refs = args.filter((v): v is { path: string; get: () => Promise<unknown> } => "path" in v);
      ownerBatches.push(refs.length);
      return refs.map((r) => ({
        id: r.path.split("/").at(-1)!, exists: base.documents.has(r.path),
        data: () => structuredClone(base.documents.get(r.path)),
      }));
    },
  };
  return { ...base, firestore, queries, ownerBatches };
}
