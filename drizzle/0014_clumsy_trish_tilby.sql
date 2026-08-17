CREATE TABLE `interestAssets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`broker` enum('moomoo_jp','rakuten_ispeed','futu','futu_hk','ibkr','sc_sg','other') NOT NULL,
	`name` varchar(160) NOT NULL,
	`currency` varchar(8) NOT NULL,
	`amount` decimal(20,2) NOT NULL,
	`annualRatePct` decimal(8,4),
	`dailyIncome` decimal(20,4),
	`cumulativeIncome` decimal(20,2),
	`compounding` boolean NOT NULL DEFAULT true,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `interestAssets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `brokerBalances` MODIFY COLUMN `broker` enum('moomoo_jp','rakuten_ispeed','futu','futu_hk','ibkr','sc_sg','other') NOT NULL;--> statement-breakpoint
ALTER TABLE `holdings` MODIFY COLUMN `market` enum('JP','US','SG','HK','OTHER') NOT NULL DEFAULT 'JP';--> statement-breakpoint
ALTER TABLE `holdings` MODIFY COLUMN `broker` enum('moomoo_jp','rakuten_ispeed','futu','futu_hk','ibkr','sc_sg','other') NOT NULL DEFAULT 'other';--> statement-breakpoint
ALTER TABLE `watchlist` MODIFY COLUMN `market` enum('JP','US','SG','HK','OTHER') NOT NULL DEFAULT 'JP';--> statement-breakpoint
ALTER TABLE `userSettings` ADD `hkdJpyRate` decimal(12,4) DEFAULT '19.0000' NOT NULL;--> statement-breakpoint
CREATE INDEX `interestAssets_user_broker_idx` ON `interestAssets` (`userId`,`broker`);