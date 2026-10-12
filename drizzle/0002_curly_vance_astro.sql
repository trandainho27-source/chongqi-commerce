CREATE TABLE `transaction_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`passed` integer NOT NULL,
	CONSTRAINT "transaction_must_pass" CHECK("transaction_guards"."passed" = 1)
);
