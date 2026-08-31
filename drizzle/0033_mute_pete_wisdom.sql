CREATE TABLE `buyPlanRankingSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`rankingMonth` varchar(7) NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`rank` int,
	`eligible` boolean NOT NULL DEFAULT false,
	`score` int NOT NULL DEFAULT 0,
	`scoreVersion` varchar(40) NOT NULL,
	`scoreBreakdown` json NOT NULL,
	`gateReasons` json NOT NULL,
	`rationale` json NOT NULL,
	`rankingFingerprint` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `buyPlanRankingSnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `buy_rank_user_month_symbol_unique` UNIQUE(`userId`,`rankingMonth`,`symbol`)
);
--> statement-breakpoint
CREATE INDEX `buy_rank_user_month_rank_idx` ON `buyPlanRankingSnapshots` (`userId`,`rankingMonth`,`rank`);