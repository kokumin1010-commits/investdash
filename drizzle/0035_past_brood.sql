ALTER TABLE `userSettings` ADD `longTermAnnualContributionJpy` decimal(20,2);--> statement-breakpoint
ALTER TABLE `userSettings` ADD `longTermScenarioConservativePct` decimal(6,2);--> statement-breakpoint
ALTER TABLE `userSettings` ADD `longTermScenarioBasePct` decimal(6,2);--> statement-breakpoint
ALTER TABLE `userSettings` ADD `longTermScenarioOptimisticPct` decimal(6,2);