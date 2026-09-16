CREATE TABLE `dailyCashFlowSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`asOfDate` varchar(10) NOT NULL,
	`netAssetsJpy` decimal(22,2) NOT NULL,
	`annualDividendJpy` decimal(22,2),
	`annualInterestJpy` decimal(22,2),
	`annualBorrowingInterestJpy` decimal(22,2),
	`annualNetCashJpy` decimal(22,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dailyCashFlowSnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `dailyCashFlowSnapshots_user_date_uq` UNIQUE(`userId`,`asOfDate`)
);
--> statement-breakpoint
CREATE INDEX `dailyCashFlowSnapshots_user_date_idx` ON `dailyCashFlowSnapshots` (`userId`,`asOfDate`);