CREATE TABLE `consultOutcomes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`consultationId` int NOT NULL,
	`messageId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`stance` enum('BUY','HOLD','REDUCE','REPAY') NOT NULL,
	`conclusion` text NOT NULL,
	`quantityAtAdvice` decimal(20,4),
	`priceAtAdvice` decimal(20,4),
	`executed` boolean,
	`executedAt` timestamp,
	`quantityAfter` decimal(20,4),
	`verdict` enum('CORRECT','WRONG','UNCLEAR'),
	`priceAtVerdict` decimal(20,4),
	`verdictAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `consultOutcomes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `consult_outcomes_user_symbol_idx` ON `consultOutcomes` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `consult_outcomes_consultation_idx` ON `consultOutcomes` (`consultationId`);--> statement-breakpoint
CREATE INDEX `consult_outcomes_pending_idx` ON `consultOutcomes` (`userId`,`executed`);