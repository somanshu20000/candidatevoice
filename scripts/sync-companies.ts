/**
 * sync-companies.ts — verify stored company links still resolve.
 *
 * Usage:
 *   npm run companies:sync                 # check every link
 *   npm run companies:sync -- --limit 100  # check the least-recently-checked 100
 *   npm run companies:sync -- --type website
 *
 * This is the one script that makes outbound network calls, and it only ever
 * ISSUES HEAD/GET requests to URLs already stored — it imports nothing and reads
 * no page content. It records last_checked_at and last_status on company_links
 * so the UI can distinguish "confirmed working", "known broken" and "never
 * checked". A broken link is flagged, never auto-deleted — deletion is a human
 * decision.
 */

import { adminClient, loadEnv, parseArgs, c } from "./_shared";

interface LinkRow {
  id: string;
  url: string;
  link_type: string;
}

async function checkUrl(url: string): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    // HEAD first; some hosts reject HEAD, so fall back to a ranged GET.
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, headers: { Range: "bytes=0-0" } });
    }
    return res.status;
  } catch {
    return 0; // network failure / timeout / DNS — recorded as 0, meaning unreachable
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  loadEnv();
  const { flags } = parseArgs(process.argv.slice(2));
  const limit = flags.get("limit") ? Number(flags.get("limit")) : undefined;
  const linkType = flags.get("type");

  const client = adminClient();
  let query = client
    .from("company_links")
    .select("id, url, link_type")
    .order("last_checked_at", { ascending: true, nullsFirst: true });
  if (linkType) query = query.eq("link_type", linkType);
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const links = (data ?? []) as LinkRow[];

  console.log(c.bold(`\nChecking ${links.length} link(s)\n`));

  let ok = 0;
  let broken = 0;

  for (const link of links) {
    const status = await checkUrl(link.url);
    const healthy = status >= 200 && status < 400;
    if (healthy) ok++;
    else broken++;

    const { error: updateError } = await client
      .from("company_links")
      .update({ last_checked_at: new Date().toISOString(), last_status: status })
      .eq("id", link.id);
    if (updateError) console.error(c.red(`  failed to record status for ${link.url}: ${updateError.message}`));

    const tag = healthy ? c.green(String(status).padStart(3)) : c.red(status === 0 ? "ERR" : String(status));
    console.log(`  ${tag} ${c.dim(link.link_type.padEnd(16))} ${link.url}`);
  }

  console.log("");
  console.log(`${c.green(`${ok} healthy`)} · ${c.red(`${broken} broken/unreachable`)}`);
  console.log(c.dim("Broken links are flagged (last_status), not deleted. Review them before removing."));
  process.exit(0);
}

main().catch((err) => {
  console.error(c.red(`\nsync-companies failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
