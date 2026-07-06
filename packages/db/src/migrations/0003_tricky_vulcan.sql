WITH ordered_events AS (
	SELECT
		`id`,
		ROW_NUMBER() OVER (
			PARTITION BY `run_id`
			ORDER BY `sequence`, `created_at`, `id`
		) AS `new_sequence`
	FROM `agent_run_event`
)
UPDATE `agent_run_event`
SET `sequence` = (
	SELECT `new_sequence`
	FROM `ordered_events`
	WHERE `ordered_events`.`id` = `agent_run_event`.`id`
);--> statement-breakpoint
DROP INDEX `agent_run_event_runSequence_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_event_runSequence_idx` ON `agent_run_event` (`run_id`,`sequence`);
