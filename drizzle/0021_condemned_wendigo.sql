CREATE TABLE `symbolNotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`kind` enum('NEWS','EARNINGS','BAND','CONSULT','OUTCOME','MANUAL') NOT NULL,
	`headline` varchar(512) NOT NULL,
	`detail` text,
	`importance` int,
	`occurredAt` timestamp NOT NULL,
	`sourceKey` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `symbolNotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `symbolNotes_source_unique` UNIQUE(`userId`,`sourceKey`)
);
--> statement-breakpoint
CREATE INDEX `symbolNotes_user_symbol_idx` ON `symbolNotes` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `symbolNotes_occurred_idx` ON `symbolNotes` (`userId`,`occurredAt`);