ALTER TABLE `signals` ADD `wouldBuyNow` enum('YES','NO','UNCLEAR');--> statement-breakpoint
ALTER TABLE `signals` ADD `wouldBuyNowReason` text;--> statement-breakpoint
ALTER TABLE `signals` ADD `priceVsValue` enum('PRICE_AHEAD','VALUE_AHEAD','IN_LINE','UNKNOWN');--> statement-breakpoint
ALTER TABLE `signals` ADD `priceVsValueReason` text;