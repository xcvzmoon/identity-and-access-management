WITH observed AS (
  SELECT floor(extract(epoch FROM statement_timestamp()) * 1000)::numeric AS now_ms
), ages AS (
  SELECT observed.now_ms - rate_limits.last_request AS age_ms
  FROM iam_idp.rate_limits CROSS JOIN observed
)
SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE age_ms < 0) AS future_timestamp_rows,
  count(*) FILTER (WHERE age_ms BETWEEN 0 AND 86400000) AS within_24_hours,
  count(*) FILTER (WHERE age_ms > 86400000 AND age_ms <= 2592000000) AS over_24_through_720_hours,
  count(*) FILTER (WHERE age_ms > 2592000000 AND age_ms <= 2678400000) AS over_720_through_744_hours,
  count(*) FILTER (WHERE age_ms > 2678400000) AS over_744_hours,
  floor(max(age_ms) FILTER (WHERE age_ms >= 0) / 3600000) AS oldest_age_hours
FROM ages;
