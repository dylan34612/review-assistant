import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limitParam = parseInt(req.nextUrl.searchParams.get("limit") ?? "250", 10);
  const limit = Math.min(Math.max(limitParam, 1), 2000);

  const params: (string | number)[] = [];
  let whereClause = "";
  if (search) {
    params.push(`%${search}%`);
    whereClause = `where (pm.subject ilike $1 or pm.sender ilike $1)`;
  }
  params.push(limit);
  const limitParam2 = `$${params.length}`;

  const result = await query<{
    id: string;
    subject: string;
    sender: string;
    status: string;
    error: string | null;
    processed_at: string;
    item_count: number;
    events: Array<{ id: string; level: string; message: string; details: Record<string, unknown>; created_at: string }> | null;
  }>(`
    select
      pm.id,
      pm.subject,
      pm.sender,
      pm.status,
      pm.error,
      pm.processed_at,
      count(distinct p.id)::int as item_count,
      coalesce(
        json_agg(
          json_build_object('id', pe.id, 'level', pe.level, 'message', pe.message, 'details', pe.details, 'created_at', pe.created_at)
          order by pe.created_at
        ) filter (where pe.id is not null),
        '[]'
      ) as events
    from processed_messages pm
    left join purchases p on p.source_message_id = pm.id
    left join parser_events pe on pe.processed_message_id = pm.id
    ${whereClause}
    group by pm.id
    order by pm.processed_at desc
    limit ${limitParam2}
  `, params);
  return NextResponse.json(result.rows);
}
