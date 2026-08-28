ALTER TABLE `addProposals` ADD `watchItemId` int;--> statement-breakpoint
ALTER TABLE `addProposals` ADD `reviewStatus` enum('PENDING','ACCEPTED','EDITED','REJECTED');--> statement-breakpoint
ALTER TABLE `addProposals` ADD `buyConditions` text;--> statement-breakpoint
ALTER TABLE `addProposals` ADD `confidence` int;--> statement-breakpoint
ALTER TABLE `addProposals` ADD `evidence` json;--> statement-breakpoint
ALTER TABLE `addProposals` ADD `confirmedAt` timestamp;--> statement-breakpoint
CREATE INDEX `add_proposals_watch_status_idx` ON `addProposals` (`userId`,`watchItemId`,`reviewStatus`);