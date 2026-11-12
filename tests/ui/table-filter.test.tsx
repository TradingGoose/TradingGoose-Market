// @vitest-environment jsdom

import { useMemo, useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Column } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TableFilter } from "../../components/tables/table-filter";

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

type FixtureRow = {
  name: string;
  status: string;
};

function TextFilterFixture() {
  const [filterValue, setFilterValue] = useState<string>();
  const facetedValues = useMemo(() => new Map<unknown, number>(), []);
  const column = useMemo(
    () =>
      ({
        id: "name",
        columnDef: { header: "Name", meta: { filterVariant: "text" } },
        getFilterValue: () => filterValue,
        setFilterValue: (value: unknown) => setFilterValue(typeof value === "string" ? value : undefined),
        getFacetedUniqueValues: () => facetedValues,
      }) as unknown as Column<FixtureRow, unknown>,
    [facetedValues, filterValue],
  );

  return (
    <>
      <TableFilter column={column} />
      <button type="button" onClick={() => setFilterValue("external value")}>
        Set external filter
      </button>
      <output aria-label="Applied filter">{filterValue ?? "none"}</output>
    </>
  );
}

function SelectFilterFixture({ loading = false }: { loading?: boolean }) {
  const [filterValue, setFilterValue] = useState<string>();
  const facetedValues = useMemo(() => new Map<unknown, number>(), []);
  const column = useMemo(
    () =>
      ({
        id: "status",
        columnDef: { header: "Status", meta: { filterVariant: "select" } },
        getFilterValue: () => filterValue,
        setFilterValue: (value: unknown) => setFilterValue(typeof value === "string" ? value : undefined),
        getFacetedUniqueValues: () => facetedValues,
      }) as unknown as Column<FixtureRow, unknown>,
    [facetedValues, filterValue],
  );

  return (
    <>
      <TableFilter
        column={column}
        searchable
        searchLoading={loading}
        selectOptions={loading ? [] : [
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
        ]}
      />
      <output aria-label="Applied status">{filterValue ?? "none"}</output>
    </>
  );
}

describe("TableFilter", () => {
  it("keeps text as a draft until apply and remounts the draft for external filter changes", async () => {
    const interaction = userEvent.setup();
    render(<TextFilterFixture />);

    const input = screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    await interaction.type(input, "apple");
    expect(screen.getByRole("status", { name: "Applied filter" }).textContent).toBe("none");

    await interaction.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("status", { name: "Applied filter" }).textContent).toBe("apple");

    await interaction.clear(screen.getByRole("textbox", { name: "Name" }));
    await interaction.type(screen.getByRole("textbox", { name: "Name" }), "unsaved draft");
    await interaction.click(screen.getByRole("button", { name: "Set external filter" }));

    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("external value");
    await interaction.clear(screen.getByRole("textbox", { name: "Name" }));
    await interaction.type(screen.getByRole("textbox", { name: "Name" }), "   ");
    await interaction.keyboard("{Enter}");
    expect(screen.getByRole("status", { name: "Applied filter" }).textContent).toBe("none");
  });

  it("applies and clears searchable select values", async () => {
    const interaction = userEvent.setup();
    render(<SelectFilterFixture />);

    await interaction.click(screen.getByRole("combobox", { name: "Select Status" }));
    await interaction.type(screen.getByPlaceholderText("Search status..."), "active");
    await interaction.click(screen.getByText("Active"));

    expect(screen.getByRole("status", { name: "Applied status" }).textContent).toBe("active");
    expect(screen.getByRole("combobox", { name: "Active" })).toBeTruthy();

    await interaction.click(screen.getByRole("combobox", { name: "Active" }));
    await interaction.clear(screen.getByPlaceholderText("Search status..."));
    await interaction.click(screen.getByText("All"));
    expect(screen.getByRole("status", { name: "Applied status" }).textContent).toBe("none");
  });

  it("uses the shared Skeleton primitive for remote search loading", async () => {
    const interaction = userEvent.setup();
    render(<SelectFilterFixture loading />);

    await interaction.click(screen.getByRole("combobox", { name: "Select Status" }));
    await interaction.type(screen.getByPlaceholderText("Search status..."), "remote");
    await waitFor(() => expect(screen.getByText("Loading results...")).toBeTruthy());
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });
});
