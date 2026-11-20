SELECT
  statement_timestamp() AS sampled_at,
  count(*) FILTER (WHERE expires_at > statement_timestamp()) AS unexpired_sessions,
  count(*) FILTER (WHERE expires_at <= statement_timestamp()) AS expired_sessions,
  count(*) FILTER (WHERE expires_at <= statement_timestamp() AND nullif(ip_address, '') IS NOT NULL)
    AS expired_with_client_address,
  count(*) FILTER (WHERE expires_at <= statement_timestamp() AND nullif(user_agent, '') IS NOT NULL)
    AS expired_with_user_agent,
  floor(extract(epoch FROM statement_timestamp() - min(expires_at) FILTER (
    WHERE expires_at <= statement_timestamp()
      AND (nullif(ip_address, '') IS NOT NULL OR nullif(user_agent, '') IS NOT NULL)
  )) / 3600) AS oldest_expired_metadata_hours
FROM iam_idp.sessions;
