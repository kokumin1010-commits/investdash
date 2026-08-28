ALTER TABLE `signals` ADD `dataQuality` enum('STRONG','MODERATE','LIMITED');--> statement-breakpoint
ALTER TABLE `signals` ADD `reviewTriggers` json;--> statement-breakpoint
ALTER TABLE `signals` ADD `riskFlags` json;--> statement-breakpoint
ALTER TABLE `signals` ADD `validUntil` timestamp;--> statement-breakpoint
ALTER TABLE `signals` ADD `schemaVersion` int DEFAULT 1 NOT NULL;