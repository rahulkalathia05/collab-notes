"""
Analytics repository — pure aggregation queries against the existing schema.

All time-series queries use generate_series so days with zero activity still
appear in the result (essential for front-end charts).

Query design notes
──────────────────
* interval strings are parameterised as :days + ' days' to avoid injection.
  PostgreSQL accepts 'N days' literals from bound parameters.
* active_users_over_time counts DISTINCT users across three event sources
  (note creation, version snapshots, comments) with a UNION ALL so a user
  who does all three on the same day is still counted once.
* ai_usage_over_time uses json_object_agg to return per-action breakdowns
  in a single row, avoiding a Python-side pivot.
"""

from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class AnalyticsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── overview scalars ──────────────────────────────────────────────────────

    async def overview(self, workspace_id: UUID, period_days: int) -> dict:
        sql = text("""
            WITH period AS (
                SELECT now() - (:days || ' days')::interval AS since,
                       now() - (:days2 || ' days')::interval AS prev_since
            )
            SELECT
              -- current period
              (SELECT COUNT(*) FROM notes
               WHERE workspace_id = :wid AND is_archived = false
                 AND created_at >= (SELECT since FROM period)) AS notes_current,
              (SELECT COUNT(*) FROM note_versions nv
               JOIN notes n ON n.id = nv.note_id AND n.workspace_id = :wid
               WHERE nv.created_at >= (SELECT since FROM period)) AS edits_current,
              (SELECT COUNT(*) FROM ai_events
               WHERE workspace_id = :wid
                 AND created_at >= (SELECT since FROM period)) AS ai_current,
              (SELECT COUNT(*) FROM comments c
               JOIN notes n ON n.id = c.note_id AND n.workspace_id = :wid
               WHERE c.created_at >= (SELECT since FROM period)) AS comments_current,
              -- previous period (for delta)
              (SELECT COUNT(*) FROM notes
               WHERE workspace_id = :wid AND is_archived = false
                 AND created_at >= (SELECT prev_since FROM period)
                 AND created_at < (SELECT since FROM period)) AS notes_prev,
              (SELECT COUNT(*) FROM note_versions nv
               JOIN notes n ON n.id = nv.note_id AND n.workspace_id = :wid
               WHERE nv.created_at >= (SELECT prev_since FROM period)
                 AND nv.created_at < (SELECT since FROM period)) AS edits_prev,
              (SELECT COUNT(*) FROM ai_events
               WHERE workspace_id = :wid
                 AND created_at >= (SELECT prev_since FROM period)
                 AND created_at < (SELECT since FROM period)) AS ai_prev,
              (SELECT COUNT(*) FROM comments c
               JOIN notes n ON n.id = c.note_id AND n.workspace_id = :wid
               WHERE c.created_at >= (SELECT prev_since FROM period)
                 AND c.created_at < (SELECT since FROM period)) AS comments_prev,
              -- all-time totals
              (SELECT COUNT(*) FROM notes WHERE workspace_id = :wid AND is_archived = false) AS total_notes,
              (SELECT COUNT(DISTINCT user_id) FROM workspace_members WHERE workspace_id = :wid) AS total_users
        """)
        result = await self.session.execute(sql, {"wid": str(workspace_id), "days": period_days, "days2": period_days * 2})
        return dict(result.mappings().one())

    # ── time series ───────────────────────────────────────────────────────────

    async def notes_over_time(self, workspace_id: UUID, period_days: int) -> list[dict]:
        sql = text("""
            WITH dates AS (
              SELECT generate_series(
                (now() - (:days || ' days')::interval)::date,
                now()::date,
                '1 day'
              )::date AS day
            ),
            counts AS (
              SELECT created_at::date AS day, COUNT(*) AS count
              FROM notes
              WHERE workspace_id = :wid AND is_archived = false
                AND created_at >= now() - (:days || ' days')::interval
              GROUP BY 1
            )
            SELECT d.day::text AS date, COALESCE(c.count, 0)::int AS count
            FROM dates d LEFT JOIN counts c ON c.day = d.day
            ORDER BY d.day
        """)
        result = await self.session.execute(sql, {"wid": str(workspace_id), "days": period_days})
        return [dict(r) for r in result.mappings()]

    async def edits_over_time(self, workspace_id: UUID, period_days: int) -> list[dict]:
        sql = text("""
            WITH dates AS (
              SELECT generate_series(
                (now() - (:days || ' days')::interval)::date,
                now()::date, '1 day'
              )::date AS day
            ),
            counts AS (
              SELECT nv.created_at::date AS day, COUNT(*) AS count
              FROM note_versions nv
              JOIN notes n ON n.id = nv.note_id AND n.workspace_id = :wid
              WHERE nv.created_at >= now() - (:days || ' days')::interval
              GROUP BY 1
            )
            SELECT d.day::text AS date, COALESCE(c.count, 0)::int AS count
            FROM dates d LEFT JOIN counts c ON c.day = d.day
            ORDER BY d.day
        """)
        result = await self.session.execute(sql, {"wid": str(workspace_id), "days": period_days})
        return [dict(r) for r in result.mappings()]

    async def active_users_over_time(self, workspace_id: UUID, period_days: int) -> list[dict]:
        sql = text("""
            WITH dates AS (
              SELECT generate_series(
                (now() - (:days || ' days')::interval)::date,
                now()::date, '1 day'
              )::date AS day
            ),
            events AS (
              SELECT created_at AS ts, created_by AS uid FROM notes WHERE workspace_id = :wid
              UNION ALL
              SELECT nv.created_at, nv.snapshot_by
              FROM note_versions nv JOIN notes n ON n.id = nv.note_id AND n.workspace_id = :wid
              UNION ALL
              SELECT c.created_at, c.user_id
              FROM comments c JOIN notes n ON n.id = c.note_id AND n.workspace_id = :wid
            ),
            counts AS (
              SELECT ts::date AS day, COUNT(DISTINCT uid) AS count
              FROM events
              WHERE ts >= now() - (:days || ' days')::interval
              GROUP BY 1
            )
            SELECT d.day::text AS date, COALESCE(c.count, 0)::int AS count
            FROM dates d LEFT JOIN counts c ON c.day = d.day
            ORDER BY d.day
        """)
        result = await self.session.execute(sql, {"wid": str(workspace_id), "days": period_days})
        return [dict(r) for r in result.mappings()]

    async def ai_usage_over_time(self, workspace_id: UUID, period_days: int) -> list[dict]:
        sql = text("""
            WITH dates AS (
              SELECT generate_series(
                (now() - (:days || ' days')::interval)::date,
                now()::date, '1 day'
              )::date AS day
            ),
            daily AS (
              SELECT
                created_at::date AS day,
                COUNT(*) AS count,
                json_object_agg(action, action_count) AS by_action
              FROM (
                SELECT action, created_at, COUNT(*) OVER (PARTITION BY created_at::date, action) AS action_count
                FROM ai_events
                WHERE workspace_id = :wid
                  AND created_at >= now() - (:days || ' days')::interval
              ) sub
              GROUP BY 1
            )
            SELECT
              d.day::text AS date,
              COALESCE(dl.count, 0)::int AS count,
              COALESCE(dl.by_action, '{}'::json) AS by_action
            FROM dates d LEFT JOIN daily dl ON dl.day = d.day
            ORDER BY d.day
        """)
        result = await self.session.execute(sql, {"wid": str(workspace_id), "days": period_days})
        rows = []
        for r in result.mappings():
            row = dict(r)
            # by_action may be a string or dict depending on driver
            by_action = row.get("by_action") or {}
            if isinstance(by_action, str):
                import json
                by_action = json.loads(by_action)
            row["by_action"] = {k: int(v) for k, v in by_action.items()}
            rows.append(row)
        return rows

    async def collaboration_over_time(self, workspace_id: UUID, period_days: int) -> list[dict]:
        sql = text("""
            WITH dates AS (
              SELECT generate_series(
                (now() - (:days || ' days')::interval)::date,
                now()::date, '1 day'
              )::date AS day
            ),
            counts AS (
              SELECT c.created_at::date AS day, COUNT(*) AS count
              FROM comments c
              JOIN notes n ON n.id = c.note_id AND n.workspace_id = :wid
              WHERE c.created_at >= now() - (:days || ' days')::interval
              GROUP BY 1
            )
            SELECT d.day::text AS date, COALESCE(c.count, 0)::int AS count
            FROM dates d LEFT JOIN counts c ON c.day = d.day
            ORDER BY d.day
        """)
        result = await self.session.execute(sql, {"wid": str(workspace_id), "days": period_days})
        return [dict(r) for r in result.mappings()]

    # ── tables ────────────────────────────────────────────────────────────────

    async def top_notes(self, workspace_id: UUID, period_days: int, limit: int = 8) -> list[dict]:
        sql = text("""
            SELECT
              n.id::text           AS note_id,
              n.title,
              COUNT(DISTINCT nv.id)::int  AS edits,
              COUNT(DISTINCT c.id)::int   AS comments,
              n.updated_at         AS last_activity
            FROM notes n
            LEFT JOIN note_versions nv
              ON nv.note_id = n.id
              AND nv.created_at >= now() - (:days || ' days')::interval
            LEFT JOIN comments c
              ON c.note_id = n.id
              AND c.created_at >= now() - (:days || ' days')::interval
            WHERE n.workspace_id = :wid AND n.is_archived = false
            GROUP BY n.id, n.title, n.updated_at
            HAVING COUNT(DISTINCT nv.id) + COUNT(DISTINCT c.id) > 0
            ORDER BY COUNT(DISTINCT nv.id) + COUNT(DISTINCT c.id) DESC
            LIMIT :limit
        """)
        result = await self.session.execute(sql, {
            "wid": str(workspace_id), "days": period_days, "limit": limit
        })
        return [dict(r) for r in result.mappings()]

    async def member_activity(self, workspace_id: UUID, period_days: int) -> list[dict]:
        sql = text("""
            SELECT
              u.id::text      AS user_id,
              u.name,
              u.email,
              u.avatar_url,
              COALESCE(nc.cnt, 0)::int  AS notes_created,
              COALESCE(vc.cnt, 0)::int  AS edits,
              COALESCE(cc.cnt, 0)::int  AS comments,
              (COALESCE(nc.cnt,0) + COALESCE(vc.cnt,0) + COALESCE(cc.cnt,0))::int AS total
            FROM workspace_members wm
            JOIN users u ON u.id = wm.user_id
            LEFT JOIN (
              SELECT created_by, COUNT(*) AS cnt
              FROM notes
              WHERE workspace_id = :wid
                AND created_at >= now() - (:days || ' days')::interval
              GROUP BY created_by
            ) nc ON nc.created_by = u.id
            LEFT JOIN (
              SELECT nv.snapshot_by, COUNT(*) AS cnt
              FROM note_versions nv
              JOIN notes n ON n.id = nv.note_id AND n.workspace_id = :wid
              WHERE nv.created_at >= now() - (:days || ' days')::interval
              GROUP BY nv.snapshot_by
            ) vc ON vc.snapshot_by = u.id
            LEFT JOIN (
              SELECT c.user_id, COUNT(*) AS cnt
              FROM comments c
              JOIN notes n ON n.id = c.note_id AND n.workspace_id = :wid
              WHERE c.created_at >= now() - (:days || ' days')::interval
              GROUP BY c.user_id
            ) cc ON cc.user_id = u.id
            WHERE wm.workspace_id = :wid
            ORDER BY total DESC
        """)
        result = await self.session.execute(sql, {"wid": str(workspace_id), "days": period_days})
        return [dict(r) for r in result.mappings()]

    # ── event log ─────────────────────────────────────────────────────────────

    async def log_ai_event(
        self,
        workspace_id: UUID,
        note_id: UUID | None,
        user_id: UUID,
        action: str,
    ) -> None:
        """Fire-and-forget event log. Called from background tasks."""
        await self.session.execute(
            text("""
                INSERT INTO ai_events (workspace_id, note_id, user_id, action)
                VALUES (:wid, :nid, :uid, :action)
            """),
            {
                "wid": str(workspace_id),
                "nid": str(note_id) if note_id else None,
                "uid": str(user_id),
                "action": action,
            },
        )
        await self.session.commit()
