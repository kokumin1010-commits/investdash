CREATE TABLE `cashIncomeRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` enum('DIVIDEND','INTEREST') NOT NULL,
	`status` enum('ACCRUED','SETTLED') NOT NULL DEFAULT 'SETTLED',
	`occurredOn` date NOT NULL,
	`broker` enum('moomoo_jp','rakuten_ispeed','futu','futu_hk','ibkr','sc_sg','other') NOT NULL,
	`symbol` varchar(24),
	`name` varchar(160) NOT NULL,
	`currency` varchar(8) NOT NULL,
	`grossAmount` decimal(20,4) NOT NULL,
	`taxAmount` decimal(20,4),
	`feeAmount` decimal(20,4),
	`netAmount` decimal(20,4) NOT NULL,
	`fxRateJpy` decimal(20,8),
	`source` varchar(40) NOT NULL DEFAULT 'MANUAL',
	`sourceReference` varchar(255),
	`dedupeKey` varchar(191) NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cashIncomeRecords_id` PRIMARY KEY(`id`),
	CONSTRAINT `cash_income_user_dedupe_unique` UNIQUE(`userId`,`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `interestAssetIncomeSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`interestAssetId` int NOT NULL,
	`broker` enum('moomoo_jp','rakuten_ispeed','futu','futu_hk','ibkr','sc_sg','other') NOT NULL,
	`name` varchar(160) NOT NULL,
	`currency` varchar(8) NOT NULL,
	`incomeDate` date NOT NULL,
	`amount` decimal(20,2) NOT NULL,
	`annualRatePct` decimal(8,4),
	`dailyIncome` decimal(20,4),
	`cumulativeIncome` decimal(20,2),
	`fxRateJpy` decimal(20,8),
	`source` varchar(40) NOT NULL DEFAULT 'MANUAL_CAPTURE',
	`capturedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `interestAssetIncomeSnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `interest_income_asset_date_unique` UNIQUE(`userId`,`interestAssetId`,`incomeDate`)
);
--> statement-breakpoint
CREATE INDEX `cash_income_user_date_idx` ON `cashIncomeRecords` (`userId`,`occurredOn`);--> statement-breakpoint
CREATE INDEX `interest_income_user_date_idx` ON `interestAssetIncomeSnapshots` (`userId`,`incomeDate`);--> statement-breakpoint
INSERT INTO `interestAssetIncomeSnapshots` (
	`userId`,
	`interestAssetId`,
	`broker`,
	`name`,
	`currency`,
	`incomeDate`,
	`amount`,
	`annualRatePct`,
	`dailyIncome`,
	`cumulativeIncome`,
	`fxRateJpy`,
	`source`,
	`capturedAt`
)
SELECT
	ia.`userId`,
	ia.`id`,
	ia.`broker`,
	ia.`name`,
	UPPER(ia.`currency`),
	DATE_SUB(DATE(CONVERT_TZ(ia.`capturedAt`, '+00:00', '+09:00')), INTERVAL 1 DAY),
	ia.`amount`,
	ia.`annualRatePct`,
	ia.`dailyIncome`,
	ia.`cumulativeIncome`,
	CASE UPPER(ia.`currency`)
		WHEN 'JPY' THEN 1
		WHEN 'USD' THEN us.`usdJpyRate`
		WHEN 'SGD' THEN us.`sgdJpyRate`
		WHEN 'HKD' THEN us.`hkdJpyRate`
		ELSE NULL
	END,
	'LEGACY_BACKFILL',
	ia.`capturedAt`
FROM `interestAssets` ia
INNER JOIN `userSettings` us ON us.`userId` = ia.`userId`
WHERE ia.`dailyIncome` IS NOT NULL OR ia.`cumulativeIncome` IS NOT NULL
ON DUPLICATE KEY UPDATE
	`amount` = VALUES(`amount`),
	`annualRatePct` = VALUES(`annualRatePct`),
	`dailyIncome` = VALUES(`dailyIncome`),
	`cumulativeIncome` = VALUES(`cumulativeIncome`),
	`fxRateJpy` = VALUES(`fxRateJpy`),
	`source` = VALUES(`source`),
	`capturedAt` = VALUES(`capturedAt`);
