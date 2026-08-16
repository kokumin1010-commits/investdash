ALTER TABLE `holdings` ADD `annualDividend` decimal(20,6);--> statement-breakpoint
ALTER TABLE `holdings` ADD `dividendCount` int;--> statement-breakpoint
ALTER TABLE `holdings` ADD `lastDividendDate` timestamp;--> statement-breakpoint
ALTER TABLE `holdings` ADD `lastDividendAmount` decimal(20,6);--> statement-breakpoint
ALTER TABLE `holdings` ADD `dividendUpdatedAt` timestamp;