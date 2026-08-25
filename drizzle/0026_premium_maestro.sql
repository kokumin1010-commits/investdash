CREATE TABLE `schedulerRunLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` varchar(64) NOT NULL,
	`trigger` enum('SCHEDULED','MANUAL','STARTUP') NOT NULL DEFAULT 'SCHEDULED',
	`status` enum('RUNNING','SUCCESS','PARTIAL','FAILED','SKIPPED') NOT NULL DEFAULT 'RUNNING',
	`processed` int NOT NULL DEFAULT 0,
	`succeeded` int NOT NULL DEFAULT 0,
	`failed` int NOT NULL DEFAULT 0,
	`skipped` int NOT NULL DEFAULT 0,
	`remaining` int,
	`detailJson` json,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `schedulerRunLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `scheduler_runs_user_started_idx` ON `schedulerRunLogs` (`userId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `scheduler_runs_kind_started_idx` ON `schedulerRunLogs` (`kind`,`startedAt`);--> statement-breakpoint
CREATE INDEX `scheduler_runs_status_started_idx` ON `schedulerRunLogs` (`status`,`startedAt`);