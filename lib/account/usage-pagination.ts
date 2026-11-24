export type UsageCursorPagination = {
  cursor: string | null;
  history: string[];
};

export function initialUsageCursorPagination(): UsageCursorPagination {
  return { cursor: null, history: [] };
}

export function advanceUsageCursorPagination(
  current: UsageCursorPagination,
  nextCursor: string | null,
): UsageCursorPagination {
  if (!nextCursor) return current;
  return {
    cursor: nextCursor,
    history: [...current.history, current.cursor ?? ""],
  };
}

export function retreatUsageCursorPagination(
  current: UsageCursorPagination,
): UsageCursorPagination {
  if (current.history.length === 0) return current;
  const history = current.history.slice(0, -1);
  return {
    cursor: current.history.at(-1) || null,
    history,
  };
}
