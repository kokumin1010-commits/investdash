CREATE TABLE `recentSecuritySearches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`tickerCode` varchar(16) NOT NULL,
	`name` varchar(160) NOT NULL,
	`market` enum('JP','US','SG','HK','TW','KR','OTHER') NOT NULL,
	`currency` varchar(8),
	`searchedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recentSecuritySearches_id` PRIMARY KEY(`id`),
	CONSTRAINT `recent_security_searches_user_symbol_unique` UNIQUE(`userId`,`symbol`)
);
--> statement-breakpoint
CREATE INDEX `recent_security_searches_user_searched_idx` ON `recentSecuritySearches` (`userId`,`searchedAt`);