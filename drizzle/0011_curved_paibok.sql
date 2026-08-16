ALTER TABLE `holdings` ADD `hasSpecialDividend` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `holdings` ADD `recurringDividend` decimal(20,6);