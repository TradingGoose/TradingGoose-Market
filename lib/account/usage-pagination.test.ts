import { describe, expect, it } from "vitest";
import {
  advanceUsageCursorPagination,
  initialUsageCursorPagination,
  retreatUsageCursorPagination,
} from "./usage-pagination";

describe("usage cursor history", () => {
  it("advances, retreats, and fully resets after a server-side filter changes", () => {
    const secondPage = advanceUsageCursorPagination(
      initialUsageCursorPagination(),
      "cursor-page-2",
    );
    const thirdPage = advanceUsageCursorPagination(secondPage, "cursor-page-3");

    expect(thirdPage).toEqual({
      cursor: "cursor-page-3",
      history: ["", "cursor-page-2"],
    });
    expect(retreatUsageCursorPagination(thirdPage)).toEqual({
      cursor: "cursor-page-2",
      history: [""],
    });
    expect(initialUsageCursorPagination()).toEqual({ cursor: null, history: [] });
  });

  it("does not mutate pagination when no next cursor exists", () => {
    const current = { cursor: "cursor-page-2", history: [""] };
    expect(advanceUsageCursorPagination(current, null)).toBe(current);
  });
});
