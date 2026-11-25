"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ItemPicker } from "@/components/app/item-picker";
import { DatePickerBS } from "@/components/ui/date-picker-bs";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Item } from "@/lib/repos/items";

/** Medicine, From, To, Show: the stock ledger's choices, kept in the address. */
export function StockLedgerFilter({
  items,
  itemId,
  fromBs,
  toBs,
}: {
  items: Item[];
  itemId: string;
  fromBs: string;
  toBs: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [item, setItem] = useState(itemId);
  const [from, setFrom] = useState(fromBs);
  const [to, setTo] = useState(toBs);
  const backwards = from !== "" && to !== "" && from > to;

  function show() {
    const sp = new URLSearchParams({ item, from, to });
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 rounded-[10px] border border-line bg-cream-50 p-4">
      <div className="min-w-[260px] flex-1">
        <Field label="Medicine" htmlFor="ledger-item">
          <ItemPicker id="ledger-item" items={items} value={item} onChange={setItem} placeholder="Type a name, or pick from the list" />
        </Field>
      </div>
      <div className="w-[170px]">
        <Field label="From" htmlFor="ledger-from">
          <DatePickerBS id="ledger-from" value={from} onChange={setFrom} typeMonthAs="start" />
        </Field>
      </div>
      <div className="w-[170px]">
        <Field label="To" htmlFor="ledger-to">
          <DatePickerBS id="ledger-to" value={to} onChange={setTo} typeMonthAs="end" />
        </Field>
      </div>
      <Button onClick={show} disabled={!item || !from || !to || backwards}>
        Show
      </Button>
      {backwards && <p className="w-full text-[13px] text-danger-600">The From date is after the To date.</p>}
    </div>
  );
}
