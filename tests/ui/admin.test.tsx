// @vitest-environment jsdom

import { useMemo, useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CountryEditDialog } from "../../app/admin/countries/components/countries-edit-dialog";
import type { CountryRow } from "../../app/admin/countries/components/types";
import { MarketHoursTable } from "../../app/admin/market-hours/components/market-hours-table";
import type { MarketHourRow } from "../../app/admin/market-hours/components/types";
import { EditDialogFooter } from "../../components/edit-dialog";
import { DataTable } from "../../components/tables/data-table";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

type FixtureRow = { id: string; name: string };

function DataTableFixture({
  data,
  isLoading = false,
  loadError = null,
}: {
  data: FixtureRow[];
  isLoading?: boolean;
  loadError?: string | null;
}) {
  const columns = useMemo<ColumnDef<FixtureRow>[]>(
    () => [
      { accessorKey: "name", header: "Name", size: 240 },
    ],
    [],
  );
  // TanStack Table intentionally returns non-memoizable functions; this fixture exercises them directly.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="flex h-80 flex-col">
      <DataTable
        table={table}
        isLoading={isLoading}
        loadError={loadError}
        loadingMessage="Loading records…"
        emptyMessage="No records found."
      />
    </div>
  );
}

const marketHour: MarketHourRow = {
  id: "hours_1",
  countryId: "country_1",
  countryCode: "US",
  countryName: "United States",
  cityId: "city_1",
  cityName: "New York",
  marketId: "market_1",
  marketCode: "XNYS",
  marketName: "New York Stock Exchange",
  assetClass: "stock",
  listingId: "listing_1",
  listingBase: "NYSE:IBM",
  timeZoneId: "timezone_1",
  timeZoneName: "America/New_York",
  timeZoneOffset: "-05:00",
  timeZoneOffsetDst: "-04:00",
  sessionsCount: 5,
  holidaysCount: 10,
  updatedAt: "2026-07-19T12:00:00.000Z",
};

const country: CountryRow = {
  id: "country_1",
  code: "US",
  name: "United States",
  iconUrl: null,
  updatedAt: "2026-07-19T12:00:00.000Z",
};

function CountryDialogFixture() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open country editor
      </button>
      <CountryEditDialog
        country={country}
        open={open}
        onOpenChange={setOpen}
        onSave={() => undefined}
      />
    </>
  );
}

describe("Studio-shaped admin table and dialog behavior", () => {
  it("renders bounded loading, error, empty, and keyboard-sortable table states", async () => {
    const interaction = userEvent.setup();
    const view = render(<DataTableFixture data={[]} isLoading />);

    expect(screen.getByRole("status").textContent).toContain("Loading records…");

    view.rerender(<DataTableFixture data={[]} loadError="Records are unavailable." />);
    expect(screen.getByRole("alert").textContent).toContain("Records are unavailable.");

    view.rerender(<DataTableFixture data={[]} />);
    expect(screen.getByRole("status").textContent).toContain("No records found.");

    view.rerender(
      <DataTableFixture
        data={[
          { id: "row_z", name: "Zulu" },
          { id: "row_a", name: "Alpha" },
        ]}
      />,
    );

    const sortButton = screen.getByRole("button", { name: "Sort by Name" });
    sortButton.focus();
    await interaction.keyboard("{Enter}");

    expect(screen.getByRole("columnheader", { name: /Name/ }).getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Alpha", "Zulu"]);
  });

  it("keeps shared edit actions disabled during a save and restores cancel behavior afterward", async () => {
    const interaction = userEvent.setup();
    const onCancel = vi.fn();
    const view = render(<EditDialogFooter onCancel={onCancel} loading />);

    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(<EditDialogFooter onCancel={onCancel} />);
    await interaction.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps a failed entity save in its shadcn dialog with actionable feedback", async () => {
    const interaction = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSave = vi.fn();
    const request = vi.fn(async () => new Response(JSON.stringify({ error: "Country code already exists." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", request);

    render(
      <CountryEditDialog
        country={null}
        mode="create"
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    );

    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    await interaction.type(screen.getByLabelText(/Code/), "us");
    await interaction.type(screen.getByLabelText(/Name/), "United States");
    await interaction.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Country code already exists.");
    expect(request).toHaveBeenCalledWith("/api/countries", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("starts a fresh, auto-focused edit session on reopen", async () => {
    const interaction = userEvent.setup();
    render(<CountryDialogFixture />);

    const opener = screen.getByRole("button", { name: "Open country editor" });
    await interaction.click(opener);

    const codeInput = screen.getByLabelText(/Code/) as HTMLInputElement;
    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement;
    expect(codeInput.value).toBe("US");
    expect(nameInput.value).toBe("United States");
    expect(document.activeElement).toBe(codeInput);

    await interaction.clear(nameInput);
    await interaction.type(nameInput, "Unsaved draft");
    await interaction.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await interaction.click(opener);
    expect((screen.getByLabelText(/Code/) as HTMLInputElement).value).toBe("US");
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe("United States");
  });

  it("confirms the sole Market Hours mutation and retains list state when canceled", async () => {
    const interaction = userEvent.setup();
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);

    render(<MarketHoursTable data={[marketHour]} totalCount={1} />);

    expect(screen.getByRole("button", { name: "Export JSON" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add market hours/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /edit/i })).toBeNull();
    const actions = screen.getByRole("button", { name: "Market hour actions" });
    await interaction.click(actions);
    await interaction.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByText("Delete market hours?")).toBeTruthy();
    await interaction.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("NYSE:IBM")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();

    await interaction.click(screen.getByRole("button", { name: "Market hour actions" }));
    await interaction.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const secondConfirmation = await screen.findByRole("alertdialog");
    await interaction.click(within(secondConfirmation).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/market-hours/hours_1", { method: "DELETE" }));
    expect(await screen.findByText("No market hours found.")).toBeTruthy();
  });
});
