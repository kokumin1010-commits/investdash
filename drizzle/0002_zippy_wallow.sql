CREATE TABLE `passcodeAuth` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`passcodeHash` varchar(128) NOT NULL,
	`passcodeSalt` varchar(64) NOT NULL,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`lockedUntil` timestamp,
	`lastUnlockedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `passcodeAuth_id` PRIMARY KEY(`id`),
	CONSTRAINT `passcodeAuth_ownerUserId_unique` UNIQUE(`ownerUserId`)
);
