CREATE TABLE `aiReports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` enum('WEEKLY','EARNINGS','NEWS') NOT NULL,
	`headline` varchar(300) NOT NULL,
	`body` text NOT NULL,
	`symbols` json,
	`actionCount` int NOT NULL DEFAULT 0,
	`periodStart` timestamp,
	`periodEnd` timestamp,
	`triggerSymbol` varchar(24),
	`model` varchar(64),
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiReports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `aiReports_user_kind_idx` ON `aiReports` (`userId`,`kind`);--> statement-breakpoint
CREATE INDEX `aiReports_created_idx` ON `aiReports` (`userId`,`createdAt`);