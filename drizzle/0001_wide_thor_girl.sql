CREATE TABLE `holdings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`tickerCode` varchar(16) NOT NULL,
	`name` varchar(160) NOT NULL,
	`market` enum('JP','US','OTHER') NOT NULL DEFAULT 'JP',
	`currency` varchar(8) NOT NULL DEFAULT 'JPY',
	`quantity` decimal(20,4) NOT NULL,
	`avgCost` decimal(20,4) NOT NULL,
	`currentPrice` decimal(20,4),
	`previousClose` decimal(20,4),
	`fiftyTwoWeekHigh` decimal(20,4),
	`fiftyTwoWeekLow` decimal(20,4),
	`sector` varchar(80),
	`industry` varchar(120),
	`businessSummary` text,
	`website` varchar(255),
	`priceUpdatedAt` timestamp,
	`profileUpdatedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `holdings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `importJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fileKey` varchar(512),
	`imageUrl` varchar(1024),
	`status` enum('PENDING','PARSED','FAILED','APPLIED') NOT NULL DEFAULT 'PENDING',
	`parsed` json,
	`accountSummary` json,
	`errorMessage` text,
	`appliedCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `importJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `investmentCards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`holdingId` int,
	`symbol` varchar(24) NOT NULL,
	`buyReason` text,
	`coreThesis` text,
	`valuationAssumption` text,
	`fairValue` decimal(20,4),
	`keyFinancials` text,
	`exitConditions` text,
	`risks` text,
	`horizon` varchar(80),
	`conviction` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investmentCards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `newsItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`title` varchar(512) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`urlHash` varchar(64) NOT NULL,
	`source` varchar(160),
	`publishedAt` timestamp,
	`sentiment` enum('POSITIVE','NEGATIVE','NEUTRAL'),
	`impactScore` int,
	`summary` text,
	`reasoning` text,
	`analyzedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `newsItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `portfolioSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`totalValue` decimal(20,2) NOT NULL,
	`totalCost` decimal(20,2) NOT NULL,
	`positionCount` int NOT NULL,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portfolioSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`action` enum('ADD','HOLD','WATCH','REDUCE','EXIT') NOT NULL,
	`confidence` int,
	`rationale` text NOT NULL,
	`factors` json,
	`priceAtSignal` decimal(20,4),
	`pnlPctAtSignal` decimal(10,4),
	`scope` enum('HOLDING','WATCHLIST') NOT NULL DEFAULT 'HOLDING',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`baseCurrency` varchar(8) NOT NULL DEFAULT 'JPY',
	`usdJpyRate` decimal(12,4) NOT NULL DEFAULT '150.0000',
	`concentrationThreshold` int NOT NULL DEFAULT 20,
	`sectorConcentrationThreshold` int NOT NULL DEFAULT 35,
	`cashBalance` decimal(20,2) NOT NULL DEFAULT '0.00',
	`autoNewsEnabled` boolean NOT NULL DEFAULT true,
	`lastPriceSyncAt` timestamp,
	`lastNewsSyncAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `userSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`tickerCode` varchar(16) NOT NULL,
	`name` varchar(160) NOT NULL,
	`market` enum('JP','US','OTHER') NOT NULL DEFAULT 'JP',
	`currency` varchar(8) NOT NULL DEFAULT 'JPY',
	`currentPrice` decimal(20,4),
	`previousClose` decimal(20,4),
	`targetPrice` decimal(20,4),
	`buyConditions` text,
	`watchReason` text,
	`plannedAmount` decimal(20,2),
	`priority` enum('HIGH','MEDIUM','LOW') NOT NULL DEFAULT 'MEDIUM',
	`sector` varchar(80),
	`industry` varchar(120),
	`priceUpdatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `watchlist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `holdings_user_symbol_idx` ON `holdings` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `importjobs_user_idx` ON `importJobs` (`userId`);--> statement-breakpoint
CREATE INDEX `cards_user_symbol_idx` ON `investmentCards` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `news_user_symbol_idx` ON `newsItems` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `news_hash_idx` ON `newsItems` (`userId`,`urlHash`);--> statement-breakpoint
CREATE INDEX `snapshots_user_idx` ON `portfolioSnapshots` (`userId`);--> statement-breakpoint
CREATE INDEX `signals_user_symbol_idx` ON `signals` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `watchlist_user_symbol_idx` ON `watchlist` (`userId`,`symbol`);