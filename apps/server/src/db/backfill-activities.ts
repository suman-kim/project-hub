/**
 * 히스토리(activities)를 지금까지의 기록으로 처음 한 번 채운다. ProjectManagement 마이그레이션에서 부른다.
 * Task Master에서 가져온 task는 한 줄씩 넣으면 수백 줄이 같은 시각에 쌓이므로 앱마다 한 줄로 묶는다.
 */
export const BACKFILL_ACTIVITIES_SQL = [
  `INSERT INTO activities (app_id, at, kind, actor, ref_type, ref_id, summary, data)
   SELECT t.app_id, t.created_at, 'task.created', 'hub', 'task', t.id, t.id || ' 생성: ' || t.title, '{}'::jsonb
   FROM tasks t WHERE NOT (t.metadata ? 'taskmaster')`,
  `INSERT INTO activities (app_id, at, kind, actor, ref_type, ref_id, summary, data)
   SELECT t.app_id, min(t.created_at), 'tasks.imported', 'me', NULL, NULL,
          'Task Master에서 task ' || count(*) || '개 가져옴', jsonb_build_object('count', count(*))
   FROM tasks t WHERE t.metadata ? 'taskmaster' GROUP BY t.app_id`,
  `INSERT INTO activities (app_id, at, kind, actor, ref_type, ref_id, summary, data)
   SELECT t.app_id, (n->>'ts')::timestamptz, 'task.note', 'hub', 'task', t.id,
          t.id || ' ' || (n->>'status') || ': ' || left(n->>'note', 500), jsonb_build_object('status', n->>'status')
   FROM tasks t, jsonb_array_elements(COALESCE(t.metadata->'notes', '[]'::jsonb)) n`,
  `INSERT INTO activities (app_id, at, kind, actor, ref_type, ref_id, summary, data)
   SELECT COALESCE(t.app_id, (r.result->'idea'->>'appId')::int, (r.result->'bootstrap'->>'appId')::int),
          COALESCE(r.ended_at, r.started_at, r.created_at), 'run.finished', 'hub', 'run', r.id::text,
          'run ' || r.id || ' ' || r.kind || ' ' || r.status || ' · $' || round(r.cost_usd, 2),
          jsonb_build_object('status', r.status, 'kind', r.kind, 'costUsd', r.cost_usd, 'taskId', r.task_id)
   FROM runs r LEFT JOIN tasks t ON t.id = r.task_id WHERE r.status IN ('done', 'failed', 'stopped')`,
  `INSERT INTO activities (app_id, at, kind, actor, ref_type, ref_id, summary, data)
   SELECT i.app_id, i.created_at, 'idea.created', 'hub', 'idea', i.id::text, '기획 #' || i.id || ' 생성: ' || i.title,
          jsonb_build_object('kind', i.kind)
   FROM ideas i`,
  `INSERT INTO activities (app_id, at, kind, actor, ref_type, ref_id, summary, data)
   SELECT i.app_id, i.updated_at, 'idea.' || i.status, 'me', 'idea', i.id::text,
          '기획 #' || i.id || CASE i.status WHEN 'approved' THEN ' 승인: ' ELSE ' 반려: ' END || i.title, jsonb_build_object('kind', i.kind)
   FROM ideas i WHERE i.status IN ('approved', 'rejected')`,
];
