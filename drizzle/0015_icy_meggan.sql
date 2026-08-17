CREATE TABLE `aiRunLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` varchar(48) NOT NULL,
	`symbol` varchar(24),
	`model` varchar(64),
	`status` enum('SUCCESS','FAILED') NOT NULL,
	`durationMs` int,
	`detail` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiRunLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bandCheckResults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`bandId` int NOT NULL,
	`checkItem` varchar(200) NOT NULL,
	`status` enum('CLEAR','CONCERN','UNKNOWN') NOT NULL,
	`finding` text NOT NULL,
	`sourceCount` int NOT NULL DEFAULT 0,
	`priceAtCheck` decimal(20,4),
	`model` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bandCheckResults_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `priceBandPlans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`currency` varchar(8) NOT NULL,
	`scope` enum('HOLDING','WATCHLIST') NOT NULL DEFAULT 'HOLDING',
	`strategy` text,
	`rationale` text,
	`model` varchar(64),
	`editedByUser` boolean NOT NULL DEFAULT false,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `priceBandPlans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `priceBands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`planId` int NOT NULL,
	`lowerPrice` decimal(20,4),
	`upperPrice` decimal(20,4),
	`action` enum('HOLD','ADD_SMALL','ADD_MAIN','VERIFY','REDUCE') NOT NULL,
	`actionLabel` varchar(160) NOT NULL,
	`reason` text,
	`checkItems` json,
	`plannedAmount` decimal(20,2),
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `priceBands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `aiRunLogs_user_kind_idx` ON `aiRunLogs` (`userId`,`kind`);--> statement-breakpoint
CREATE INDEX `aiRunLogs_created_idx` ON `aiRunLogs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `bandCheckResults_band_idx` ON `bandCheckResults` (`bandId`);--> statement-breakpoint
CREATE INDEX `priceBandPlans_user_symbol_idx` ON `priceBandPlans` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `priceBands_plan_idx` ON `priceBands` (`planId`);