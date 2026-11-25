/**
 * The stock ledger (owner, 2083-08-09): one medicine's opening stock on the
 * first day, each movement, and the closing stock, against an isolated file DB.
 * Days are Nepal days.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `stock-ledger.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

function splitStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

let itemId = "";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${DB_FILE}${suffix}`, { force: true });
    } catch {
      // a lingering handle on Windows
    }
  }
});

beforeAll(async () => {
  const { __resetDbForTests } = await import("@/lib/db");
  __resetDbForTests();
  const raw = createClient({ url: `file:${DB_FILE}` });
  const migDir = join(__dirname, "..", "db", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of splitStatements(readFileSync(join(migDir, f), "utf8"))) await raw.execute(stmt);
  }
  await raw.execute("INSERT INTO users (id, name, username, password_hash, role_id, created_at) VALUES ('u1','Sarita','admin','x','admin','t')");
  await raw.execute("INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')");
  await raw.execute("INSERT INTO suppliers (id, name, created_at) VALUES ('s1','Sample Distributors','t')");
  await raw.execute("INSERT INTO purchases (id, purchase_no, supplier_id, date_ad, date_bs, created_at) VALUES ('p1','PI-2083/84-000001','s1','2026-11-21','2083-08-05','t')");
  raw.close();

  const { createItem } = await import("@/lib/repos/items");
  const { createBatchWithStock, applyStockMove } = await import("@/lib/repos/batches");
  itemId = await createItem({
    brandName: "Sample Paracetamol 500", genericName: "Paracetamol", category: "Medicine", manufacturer: "",
    minStockBaseQty: 0, controlledFlag: false, preferredSupplierId: null, active: true, shape: "tablet",
    units: [
      { level: 0, name: "Tablet", factorToBase: 1, sellingRatePaisa: 200, isDefaultSelling: true },
      { level: 1, name: "Strip", factorToBase: 10, sellingRatePaisa: 2000, isDefaultSelling: false },
    ],
  });
  const opening = await createBatchWithStock({
    itemId, batchNo: "OP-1", mfgDateAd: null, expiryDateAd: "2028-01-01", costPaisaPerBase: 100,
    baseQty: 100, supplierId: null, purchaseId: null, userId: "u1", reason: "opening",
  });
  const bought = await createBatchWithStock({
    itemId, batchNo: "PU-2", mfgDateAd: null, expiryDateAd: "2028-06-01", costPaisaPerBase: 100,
    baseQty: 50, supplierId: "s1", purchaseId: "p1", userId: "u1", reason: "purchase",
  });
  await applyStockMove({ batchId: opening, itemId, baseQtyDelta: -30, reason: "sale", refTable: null, refId: null, userId: "u1" });
  await applyStockMove({ batchId: bought, itemId, baseQtyDelta: -5, reason: "damaged", refTable: null, refId: null, userId: "u1" });

  // date the moves (test only): opening 2083-08-01, purchase 2083-08-05 at 11:50 PM
  // Nepal time (18:05 UTC, still the 5th in Nepal), sale and damage on 2083-08-09
  const { db } = await import("@/lib/db");
  const moves = (await db().execute("SELECT id, reason FROM stock_moves ORDER BY rowid")).rows;
  const at: Record<string, string> = {
    opening: "2026-11-17T04:00:00.000Z",
    purchase: "2026-11-21T18:05:00.000Z",
    sale: "2026-11-25T05:00:00.000Z",
    damaged: "2026-11-25T06:00:00.000Z",
  };
  for (const m of moves) await db().execute({ sql: "UPDATE stock_moves SET at = ? WHERE id = ?", args: [at[m.reason as string]!, m.id as string] });
});

describe("the stock ledger", () => {
  it("starts from what was there before the first day and adds up to the closing stock", async () => {
    const { stockLedger } = await import("@/lib/repos/stock-ledger");
    // 2083-08-05 .. 2083-08-09 = 2026-11-21 .. 2026-11-25
    const l = await stockLedger(itemId, "2026-11-21", "2026-11-25");
    expect(l.openingBase).toBe(100);
    expect(l.groups.map((g) => [g.group, g.inBase, g.outBase])).toEqual([
      ["purchase", 50, 0],
      ["sale", 0, 30],
      ["stock_out", 0, 5],
    ]);
    expect(l.closingBase).toBe(115);
    expect(l.lines.map((x) => x.balanceBase)).toEqual([150, 120, 115]);
    expect(l.lines[0]!.docNo).toBe("PI-2083/84-000001");
    expect(l.lines[0]!.party).toBe("Sample Distributors");
    expect(l.lines[2]!.particulars).toBe("Stock out: Damaged or broken");
  });

  it("counts a move at 11:50 PM on the day it happened in Nepal", async () => {
    const { stockLedger } = await import("@/lib/repos/stock-ledger");
    const fifth = await stockLedger(itemId, "2026-11-21", "2026-11-21");
    expect(fifth.inBase).toBe(50);
    const sixth = await stockLedger(itemId, "2026-11-22", "2026-11-22");
    expect(sixth.lines).toHaveLength(0);
    expect(sixth.openingBase).toBe(150);
    expect(sixth.closingBase).toBe(150);
  });

  it("agrees with the stock on the shelf at the end", async () => {
    const { stockLedger } = await import("@/lib/repos/stock-ledger");
    const { db } = await import("@/lib/db");
    const l = await stockLedger(itemId, "2026-11-01", "2026-12-31");
    const shelf = Number((await db().execute({ sql: "SELECT SUM(remaining_base_qty) q FROM batches WHERE item_id = ?", args: [itemId] })).rows[0]!.q);
    expect(l.openingBase).toBe(0);
    expect(l.closingBase).toBe(shelf);
  });
});
