import { redirect } from "next/navigation";

/** The doctors' board now lives on Pre-Booking, with the day's tests (2083-08-06). */
export default async function DoctorsBoardPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const sp = await searchParams;
  redirect(sp.on && /^\d{4}-\d{2}-\d{2}$/.test(sp.on) ? `/prebooking?on=${sp.on}` : "/prebooking");
}
