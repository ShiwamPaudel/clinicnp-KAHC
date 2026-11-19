import { LabStagePage } from "@/app/(app)/sendout/stage-page";

export const metadata = { title: "Laboratory — to collect" };

export default async function Page() {
  return (
    <LabStagePage
      stage="to_collect"
      copy={{
        actionLabel: "Sample collected",
        revertLabel: "",
        stampPrefix: "",
        emptyTitle: "No samples waiting",
        emptyBody:
          "A patient billed for a laboratory test appears here as soon as the bill is saved.",
      }}
    />
  );
}
