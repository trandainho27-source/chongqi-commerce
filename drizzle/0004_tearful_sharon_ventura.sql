CREATE TABLE `payment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`tx_id` text NOT NULL,
	`address` text NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transaction_address` ON `payment_transactions` (`tx_id`,`address`);