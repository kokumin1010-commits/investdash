CREATE TABLE `brokerCashSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`broker` enum('moomoo_jp','rakuten_ispeed','futu','futu_hk','ibkr','sc_sg','other') NOT NULL,
	`currency` varchar(8) NOT NULL,
	`asOfDate` date NOT NULL,
	`cashBalance` decimal(20,4) NOT NULL,
	`source` varchar(32) NOT NULL DEFAULT 'SCREENSHOT_CONFIRMED',
	`sourceReference` varchar(191),
	`evidenceDigest` varchar(64),
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `brokerCashSnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `broker_cash_user_account_date_idx` UNIQUE(`userId`,`broker`,`currency`,`asOfDate`)
);
--> statement-breakpoint
CREATE INDEX `broker_cash_user_date_idx` ON `brokerCashSnapshots` (`userId`,`asOfDate`);