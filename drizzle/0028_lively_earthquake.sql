DROP INDEX `news_hash_idx` ON `newsItems`;--> statement-breakpoint
ALTER TABLE `newsItems` ADD CONSTRAINT `news_symbol_hash_unique` UNIQUE(`userId`,`symbol`,`urlHash`);