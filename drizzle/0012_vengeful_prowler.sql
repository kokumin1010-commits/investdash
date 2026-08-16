ALTER TABLE `holdings` MODIFY COLUMN `recurringDividend` decimal(18,6);--> statement-breakpoint
ALTER TABLE `holdings` ADD `monthlyDividends` json;