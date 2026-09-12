CREATE TABLE `candidateFinancialSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`source` varchar(120) NOT NULL,
	`payload` json NOT NULL,
	`lastError` text,
	`fetchedAt` timestamp NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `candidateFinancialSnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `candidate_financial_symbol_unique` UNIQUE(`symbol`)
);
--> statement-breakpoint
CREATE INDEX `candidate_financial_expires_idx` ON `candidateFinancialSnapshots` (`expiresAt`);