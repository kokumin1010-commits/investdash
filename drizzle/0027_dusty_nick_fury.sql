CREATE TABLE `systemEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`source` enum('APP','EXTERNAL_HEALTH','RAILWAY_WEBHOOK') NOT NULL,
	`kind` varchar(64) NOT NULL,
	`severity` enum('INFO','WARNING','CRITICAL','RECOVERED') NOT NULL,
	`eventKey` varchar(191),
	`title` varchar(255) NOT NULL,
	`message` text,
	`details` json,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `systemEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_events_event_key_unique` UNIQUE(`userId`,`eventKey`)
);
--> statement-breakpoint
ALTER TABLE `holdings` ADD `acquiredAt` timestamp;--> statement-breakpoint
ALTER TABLE `holdings` ADD `acquiredAtSource` enum('USER_CONFIRMED','BROKER_TRADE');--> statement-breakpoint
CREATE INDEX `system_events_user_occurred_idx` ON `systemEvents` (`userId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `system_events_kind_occurred_idx` ON `systemEvents` (`kind`,`occurredAt`);