"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { savePercentDiscountMethodAction } from "@/app/(app)/settings/actions";
import { strings } from "@/lib/strings";
import type { PercentDiscountMethod } from "@/lib/discount";

const CHOICES: { value: PercentDiscountMethod; label: string; example: string }[] = [
  { value: "of_subtotal", label: "Percentage of the sub total", example: "रू 100 at 10%: discount रू 10.00, net रू 90.00" },
  { value: "inclusive", label: "Net plus the percentage makes the sub total", example: "x + 10% = रू 100: net रू 90.91, discount रू 9.09" },
];

/**
 * Settings → Company → Bill discount (0036, owner 2083-08-10): how a discount
 * typed as a percentage at the counter becomes rupees. A discount typed in
 * rupees is never changed.
 */
export function DiscountMethodSetting({ initial }: { initial: PercentDiscountMethod }) {
  const router = useRouter();
  const toast = useToast();
  const [method, setMethod] = useState<PercentDiscountMethod>(initial);
  const [saved, setSaved] = useState<PercentDiscountMethod>(initial);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await savePercentDiscountMethodAction(method);
      if (!res.ok) {
        toast.error(res.userMessage ?? strings.somethingWentWrong);
        return;
      }
      setSaved(method);
      toast.success(strings.saved);
      router.refresh();
    });
  }

  return (
    <section className="mt-6 rounded-[10px] border border-line bg-cream-50 p-6 lg:mr-[344px]">
      <h2 className="text-[15px] font-semibold text-sage-900">Bill discount in percent</h2>
      <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Bill discount in percent">
        {CHOICES.map((c) => (
          <label key={c.value} className="flex cursor-pointer items-start gap-2.5 text-[14px] text-sage-900">
            <input
              type="radio"
              name="percent-discount-method"
              className="mt-1 h-4 w-4"
              checked={method === c.value}
              onChange={() => setMethod(c.value)}
            />
            <span>
              {c.label}
              <span className="block text-[12px] text-sage-500">{c.example}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={pending || method === saved}>
          {pending ? "Saving…" : strings.save}
        </Button>
      </div>
    </section>
  );
}
