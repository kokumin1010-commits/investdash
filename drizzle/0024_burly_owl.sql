CREATE TABLE `monthlyHoldings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotId` int NOT NULL,
	`userId` int NOT NULL,
	`periodYm` varchar(7) NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`name` varchar(160) NOT NULL,
	`market` enum('JP','US','SG','HK','OTHER') NOT NULL DEFAULT 'JP',
	`currency` varchar(8) NOT NULL DEFAULT 'JPY',
	`broker` enum('moomoo_jp','rakuten_ispeed','futu','futu_hk','ibkr','sc_sg','other') NOT NULL DEFAULT 'other',
	`quantity` decimal(20,4) NOT NULL,
	`avgCost` decimal(20,4) NOT NULL,
	`price` decimal(20,4),
	`valueJpy` decimal(20,2),
	`sector` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `monthlyHoldings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monthlySnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`periodYm` varchar(7) NOT NULL,
	`totalValueJpy` decimal(20,2) NOT NULL,
	`totalCostJpy` decimal(20,2) NOT NULL,
	`borrowedJpy` decimal(20,2),
	`cashJpy` decimal(20,2),
	`netAssetsJpy` decimal(20,2),
	`symbolCount` int NOT NULL,
	`recordCount` int NOT NULL,
	`annualDividendJpy` decimal(20,2),
	`usdJpy` decimal(12,4),
	`sgdJpy` decimal(12,4),
	`hkdJpy` decimal(12,4),
	`source` varchar(24) NOT NULL DEFAULT 'import',
	`note` text,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monthlySnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `monthly_snap_user_period_idx` UNIQUE(`userId`,`periodYm`)
);
--> statement-breakpoint
CREATE INDEX `monthly_hold_snap_idx` ON `monthlyHoldings` (`snapshotId`);--> statement-breakpoint
CREATE INDEX `monthly_hold_user_period_idx` ON `monthlyHoldings` (`userId`,`periodYm`);--> statement-breakpoint
CREATE INDEX `monthly_hold_symbol_idx` ON `monthlyHoldings` (`userId`,`symbol`);