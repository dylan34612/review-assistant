import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  const messages = await query<{
    id: string;
    subject: string;
    sender: string;
    status: string;
    error: string | null;
    processed_at: string;
    item_count: number;
  }>(`
    select
      pm.id,
      pm.subject,
      pm.sender,
      pm.status,
      pm.error,
      pm.processed_at,
      count(p.id)::int as item_count
    from processed_messages pm
    left join purchases p on p.source_message_id = pm.id
    group by pm.id
    order by pm.processed_at desc
    limit 50
  `);

  return NextResponse.json(messages.rows);
}
