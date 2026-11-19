CREATE FUNCTION iam_idp.invitation_delivery_backlog()
RETURNS TABLE (queue text, pending_deliveries bigint, oldest_pending_ms bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH deliveries AS (
    SELECT 'owner'::text AS queue, invitation_id FROM iam_idp.owner_invitation_deliveries
    UNION ALL
    SELECT 'member', invitation_id FROM iam_idp.member_invitation_deliveries
  ), backlog AS (
    SELECT deliveries.queue, count(*) AS pending, min(invitations.created_at) AS oldest
    FROM deliveries JOIN iam_idp.invitations ON invitations.id = deliveries.invitation_id
    GROUP BY deliveries.queue
  )
  SELECT kinds.queue, coalesce(backlog.pending, 0),
    greatest(0, floor(extract(epoch FROM statement_timestamp() - backlog.oldest) * 1000))::bigint
  FROM (VALUES ('owner'), ('member')) AS kinds(queue)
  LEFT JOIN backlog USING (queue);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION iam_idp.invitation_delivery_backlog() FROM PUBLIC;
