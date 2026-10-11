WITH steps AS (
  SELECT record.id,
    row_number() OVER (PARTITION BY record.run_id ORDER BY record.seq) AS ordinal,
    CASE WHEN record.seq = (
      SELECT min(first_step.seq)
      FROM agent_execution_records AS first_step
      WHERE first_step.run_id = record.run_id
        AND first_step.turn_id = record.turn_id
        AND first_step.event_type = 'step_started'
    ) THEN COALESCE((
      SELECT json_extract(turn.event_json, '$.inputIds')
      FROM agent_execution_records AS turn
      WHERE turn.run_id = record.run_id
        AND turn.turn_id = record.turn_id
        AND turn.event_type = 'turn_started'
      ORDER BY turn.seq
      LIMIT 1
    ), '[]') ELSE '[]' END AS accepted_inputs
  FROM agent_execution_records AS record
  WHERE record.event_type = 'step_started'
)
UPDATE agent_execution_records
SET event_json = json_set(
  json_remove(event_json, '$.turnId'),
  '$.ordinal', (SELECT ordinal FROM steps WHERE steps.id = agent_execution_records.id),
  '$.acceptedInputIds', json((SELECT accepted_inputs FROM steps WHERE steps.id = agent_execution_records.id))
)
WHERE event_type = 'step_started';--> statement-breakpoint
UPDATE agent_execution_records
SET event_json = json_remove(event_json, '$.turnId')
WHERE event_type = 'step_ended';--> statement-breakpoint
DELETE FROM agent_execution_records
WHERE event_type IN ('turn_started', 'turn_ended');--> statement-breakpoint
DROP INDEX IF EXISTS `agent_execution_records_run_turn_seq_idx`;--> statement-breakpoint
ALTER TABLE `agent_execution_records` DROP COLUMN `turn_id`;
