import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
async function actor(role: "anon" | "authenticated", id = "") {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function write(data: unknown, revision: number, paper = "p") {
  const result = await db.query<{ value: { applied: boolean; record: { revision: number; data: unknown } } }>(
    "select public.paper_aisle_write_record('library',$1,$2::jsonb,$3) as value", [paper, JSON.stringify(data), revision]);
  return result.rows[0].value;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values ('${owner}'),('${other}');`);
  await db.exec(readFileSync("supabase/migrations/20261027090659_reading_sync.sql", "utf8"));
  await db.query("insert into private.paper_aisle_allowed_users(user_id) values ($1)", [owner]);
}, 30000);
beforeEach(async () => { await db.exec("reset role; truncate public.paper_reading_records;"); });
afterAll(async () => { await db?.close(); });

describe("actual SQL authorization and revision contract", () => {
  it("keeps privileged helpers outside the exposed public schema", async () => {
    const publicDefiners = await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'paper_aisle_%' and p.prosecdef");
    expect(publicDefiners.rows).toHaveLength(0);
    await actor("anon");
    await expect(db.query("select private.paper_aisle_sync_access()")).rejects.toThrow(/permission denied/);
  });
  it("denies anonymous reads and writes", async () => {
    await actor("anon");
    await expect(db.query("select * from public.paper_reading_records")).rejects.toThrow(/permission denied/);
    await expect(write({ note: "no" }, 0)).rejects.toThrow(/permission denied/);
  });
  it("allows the configured owner, blocks direct mutation and protects the allowlist", async () => {
    await actor("authenticated", owner); expect((await write({ note: "private", readingStatus: "skimmed" }, 0)).applied).toBe(true);
    expect((await db.query("select * from public.paper_reading_records")).rows).toHaveLength(1);
    await expect(db.query("update public.paper_reading_records set revision=999")).rejects.toThrow(/permission denied/);
    await expect(db.query("insert into private.paper_aisle_allowed_users values ($1,now())", [other])).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.paper_reading_records")).rejects.toThrow(/permission denied/);
  });
  it("denies a second authenticated account and forged-owner queries", async () => {
    await actor("authenticated", owner); await write({ note: "owner private" }, 0);
    await actor("authenticated", other);
    expect((await db.query("select * from public.paper_reading_records where user_id=$1", [owner])).rows).toHaveLength(0);
    expect((await db.query<{ allowed: boolean }>("select public.paper_aisle_sync_access() as allowed")).rows[0].allowed).toBe(false);
    await expect(write({ note: "forged" }, 0)).rejects.toThrow(/denied/);
  });
  it("atomically compares revisions and makes stale retries non-destructive", async () => {
    await actor("authenticated", owner);
    const first = await write({ note: "a" }, 0); expect(first.record.revision).toBe(1);
    const retry = await write({ note: "a" }, 0); expect(retry.applied).toBe(false); expect(retry.record.revision).toBe(1);
    const next = await write({ note: "b" }, 1); expect(next.applied).toBe(true); expect(next.record.revision).toBe(2);
    const stale = await write({ note: "c" }, 1); expect(stale.applied).toBe(false); expect(stale.record.data).toEqual({ note: "b" });
    const simultaneous = await Promise.all([write({ note: "one" }, 0, "new"), write({ note: "two" }, 0, "new")]);
    expect(simultaneous.filter(r => r.applied)).toHaveLength(1);
  });
  it("rejects invalid data and identity fields at the database boundary", async () => {
    await actor("authenticated", owner);
    for (const data of [{ readingStatus: "done" }, { favorite: "true" }, { note: {} }, { user_id: other }, { tags: [1] }, { favoritedAt: -1 }]) {
      await expect(write(data, 0)).rejects.toThrow(/Invalid record/);
    }
    await expect(write({}, 0, "__proto__")).rejects.toThrow(/Invalid record/);
    expect((await db.query("select * from public.paper_reading_records")).rows).toHaveLength(0);
  });
});
