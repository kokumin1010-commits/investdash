CREATE TABLE `brokerBalances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`broker` enum('moomoo_jp','rakuten_ispeed','futu','ibkr','other') NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'JPY',
	`cashBalance` decimal(20,2) NOT NULL DEFAULT '0.00',
	`maintenanceMargin` decimal(20,2) NOT NULL DEFAULT '0.00',
	`interestMtd` decimal(20,2) NOT NULL DEFAULT '0.00',
	`currencyBreakdown` text,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `brokerBalances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `holdings` MODIFY COLUMN `broker` enum('moomoo_jp','rakuten_ispeed','futu','ibkr','other') NOT NULL DEFAULT 'other';--> statement-breakpoint
CREATE INDEX `brokerBalances_user_broker_idx` ON `brokerBalances` (`userId`,`broker`);