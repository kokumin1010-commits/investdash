CREATE TABLE `addProposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(24) NOT NULL,
	`held` boolean NOT NULL DEFAULT true,
	`stance` enum('BUY','WAIT','SKIP') NOT NULL,
	`conclusion` text NOT NULL,
	`rationale` text NOT NULL,
	`amountBase` decimal(20,2),
	`limitPrice` decimal(20,4),
	`priceAtProposal` decimal(20,4),
	`sharePctAtProposal` decimal(10,4),
	`invalidation` text,
	`model` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `addProposals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `add_proposals_user_symbol_idx` ON `addProposals` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `add_proposals_created_idx` ON `addProposals` (`userId`,`createdAt`);