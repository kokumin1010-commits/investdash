ALTER TABLE `userSettings` ADD `longTermTargetNetAssetsJpy` decimal(20,2);--> statement-breakpoint
ALTER TABLE `userSettings` ADD `longTermTargetDate` date;--> statement-breakpoint
ALTER TABLE `userSettings` ADD `longTermTargetAnnualDividendJpy` decimal(20,2);--> statement-breakpoint
ALTER TABLE `userSettings` ADD `longTermTargetAnnualInterestJpy` decimal(20,2);--> statement-breakpoint
ALTER TABLE `userSettings` ADD `longTermTargetAnnualNetCashJpy` decimal(20,2);--> statement-breakpoint
ALTER TABLE `userSettings` ADD `longTermTargetUpdatedAt` timestamp;