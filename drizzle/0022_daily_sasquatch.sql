CREATE TABLE `candidateSuggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`name` varchar(255) NOT NULL,
	`market` varchar(12) NOT NULL,
	`track` enum('EXPAND','FILL') NOT NULL,
	`basedOn` varchar(120),
	`gapKind` varchar(12) NOT NULL,
	`reason` text NOT NULL,
	`concern` text NOT NULL,
	`priority` enum('HIGH','MEDIUM','LOW') NOT NULL,
	`priceAtSuggestion` decimal(20,4),
	`targetPrice` decimal(20,4),
	`targetBasis` text,
	`currency` varchar(8),
	`sector` varchar(120),
	`industry` varchar(160),
	`addedToWatchlist` boolean NOT NULL DEFAULT false,
	`dismissed` boolean NOT NULL DEFAULT false,
	`model` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `candidateSuggestions_id` PRIMARY KEY(`id`),
	CONSTRAINT `candidate_suggestions_user_symbol_unique` UNIQUE(`userId`,`symbol`)
);
--> statement-breakpoint
CREATE INDEX `candidate_suggestions_user_idx` ON `candidateSuggestions` (`userId`,`createdAt`);