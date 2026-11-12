import { beforeEach, describe, expect, it, vi } from "vitest";

type CompletionRow = {
  eventId?: string;
  httpStatus: number;
  resultClass: "success" | "client_error" | "server_error";
};

const databaseState = vi.hoisted(() => ({
  current: null as unknown,
}));

vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: () => databaseState.current,
}));

import {
  classifyUsageCompletion,
  insertMarketUsageCompletion,
} from "../../lib/usage/completion";

beforeEach(() => {
  databaseState.current = null;
});

describe("Market usage completion contract", () => {
  it.each([
    [200, "success"],
    [299, "success"],
    [399, "success"],
    [400, "client_error"],
    [422, "client_error"],
    [499, "client_error"],
    [500, "server_error"],
    [599, "server_error"],
    [199, "server_error"],
    [600, "server_error"],
  ] as const)("classifies HTTP %s as %s", (status, resultClass) => {
    expect(classifyUsageCompletion(status)).toBe(resultClass);
  });

  it("normalizes an out-of-contract status to one server-error 500 insert", async () => {
    const fixture = completionDatabase({ inserted: true });
    databaseState.current = fixture.database;

    await insertMarketUsageCompletion("event_1", 700);

    expect(fixture.insertedValues()).toEqual({
      eventId: "event_1",
      httpStatus: 500,
      resultClass: "server_error",
    });
    expect(fixture.selectCount()).toBe(0);
  });

  it("treats an identical insert conflict as idempotent", async () => {
    const fixture = completionDatabase({
      inserted: false,
      existing: { httpStatus: 404, resultClass: "client_error" },
    });
    databaseState.current = fixture.database;

    await expect(insertMarketUsageCompletion("event_1", 404)).resolves.toBeUndefined();
    expect(fixture.selectCount()).toBe(1);
  });

  it("fails closed when an insert conflict records a different outcome", async () => {
    const fixture = completionDatabase({
      inserted: false,
      existing: { httpStatus: 500, resultClass: "server_error" },
    });
    databaseState.current = fixture.database;

    await expect(insertMarketUsageCompletion("event_1", 404)).rejects.toThrow(
      /conflicting outcome/,
    );
  });
});

function completionDatabase(input: {
  inserted: boolean;
  existing?: Omit<CompletionRow, "eventId">;
}) {
  let values: CompletionRow | null = null;
  let selected = 0;

  const insertBuilder = {
    values(next: CompletionRow) {
      values = next;
      return this;
    },
    onConflictDoNothing() {
      return this;
    },
    async returning() {
      return input.inserted ? [{ eventId: values?.eventId ?? "event_1" }] : [];
    },
  };
  const selectBuilder = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    async limit() {
      selected += 1;
      return input.existing ? [input.existing] : [];
    },
  };

  return {
    database: {
      insert: () => insertBuilder,
      select: () => selectBuilder,
    },
    insertedValues: () => values,
    selectCount: () => selected,
  };
}
