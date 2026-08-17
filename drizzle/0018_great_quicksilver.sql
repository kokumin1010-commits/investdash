CREATE TABLE `consultationMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`consultationId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('USER','ASSISTANT') NOT NULL,
	`content` text NOT NULL,
	`contextSnapshot` text,
	`model` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consultationMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consultations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`symbol` varchar(24),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `consultations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `consultationMessages_consultation_idx` ON `consultationMessages` (`consultationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `consultations_user_updated_idx` ON `consultations` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `consultations_symbol_idx` ON `consultations` (`userId`,`symbol`);