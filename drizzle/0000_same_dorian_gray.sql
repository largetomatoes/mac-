CREATE TABLE `notebooks` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL
);
