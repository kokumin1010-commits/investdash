CREATE TABLE `actionSkipPriceObservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`reviewId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`currency` varchar(8) NOT NULL,
	`observedDateJst` varchar(10) NOT NULL,
	`currentPrice` decimal(20,4) NOT NULL,
	`priceUpdatedAt` timestamp,
	`source` enum('HOLDING','WATCHLIST','QUEUE_BASELINE') NOT NULL,
	`observedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `actionSkipPriceObservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `skip_price_review_date_unique` UNIQUE(`reviewId`,`observedDateJst`)
);
--> statement-breakpoint
CREATE TABLE `skippedActionReviewMilestones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`reviewId` int NOT NULL,
	`milestoneType` enum('DAY_30','DAY_90','DAY_180','AFTER_EARNINGS') NOT NULL,
	`eventKey` varchar(191) NOT NULL,
	`dueAt` timestamp NOT NULL,
	`status` enum('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
	`triggerNewsId` int,
	`currentPrice` decimal(20,4),
	`returnPct` decimal(12,4),
	`highestPrice` decimal(20,4),
	`lowestPrice` decimal(20,4),
	`maxUpsidePct` decimal(12,4),
	`maxDrawdownPct` decimal(12,4),
	`observedTradingDays` int NOT NULL DEFAULT 0,
	`signalAction` enum('ADD','HOLD','WATCH','REDUCE','EXIT'),
	`outcomeVersion` varchar(40) NOT NULL,
	`outcomeQuality` enum('OUTCOME_FAVORABLE','OUTCOME_UNFAVORABLE','OUTCOME_NOT_YET_CLEAR'),
	`summary` text,
	`evaluatedAt` timestamp,
	`notifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skippedActionReviewMilestones_id` PRIMARY KEY(`id`),
	CONSTRAINT `skip_milestone_review_type_unique` UNIQUE(`reviewId`,`milestoneType`)
);
--> statement-breakpoint
CREATE TABLE `skippedActionReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`actionQueueItemId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`name` varchar(255) NOT NULL,
	`action` enum('ADD','HOLD','WATCH','REDUCE','EXIT'),
	`direction` enum('BUY','NONE','REVIEW','SELL','EXIT'),
	`currency` varchar(8) NOT NULL,
	`decisionSnapshot` json NOT NULL,
	`baselinePrice` decimal(20,4),
	`baselineQuantity` decimal(20,4),
	`baselineWeightPct` decimal(10,4),
	`recommendedShares` decimal(20,4),
	`recommendedAmountBase` decimal(20,2),
	`decisionNote` text,
	`processVersion` varchar(40) NOT NULL,
	`processQuality` enum('DISCIPLINE_SOUND','DISCIPLINE_NEEDS_IMPROVEMENT','PROCESS_UNCLEAR') NOT NULL,
	`processReasons` json NOT NULL,
	`status` enum('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
	`skippedAt` timestamp NOT NULL,
	`closedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skippedActionReviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `skip_review_user_queue_unique` UNIQUE(`userId`,`actionQueueItemId`)
);
--> statement-breakpoint
CREATE INDEX `skip_price_user_review_idx` ON `actionSkipPriceObservations` (`userId`,`reviewId`);--> statement-breakpoint
CREATE INDEX `skip_milestone_user_status_due_idx` ON `skippedActionReviewMilestones` (`userId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `skip_review_user_status_skipped_idx` ON `skippedActionReviews` (`userId`,`status`,`skippedAt`);--> statement-breakpoint
CREATE INDEX `skip_review_user_symbol_idx` ON `skippedActionReviews` (`userId`,`symbol`);