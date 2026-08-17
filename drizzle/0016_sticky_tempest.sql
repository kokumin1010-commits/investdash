CREATE TABLE `bandTransitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`fromAction` enum('HOLD','ADD_SMALL','ADD_MAIN','VERIFY','REDUCE'),
	`fromLabel` varchar(160),
	`toAction` enum('HOLD','ADD_SMALL','ADD_MAIN','VERIFY','REDUCE'),
	`toLabel` varchar(160),
	`outsideDirection` enum('ABOVE','BELOW'),
	`price` decimal(20,4),
	`currency` varchar(8),
	`priceChangePct` decimal(10,4),
	`acknowledgedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bandTransitions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `bandTransitions_user_symbol_idx` ON `bandTransitions` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `bandTransitions_created_idx` ON `bandTransitions` (`userId`,`createdAt`);