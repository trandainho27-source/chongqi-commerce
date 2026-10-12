CREATE TABLE `payment_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`address` text NOT NULL,
	`address_hex` text NOT NULL,
	`amount_units` integer NOT NULL,
	`base_units` integer NOT NULL,
	`rate` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` integer NOT NULL,
	`pay_before` integer NOT NULL,
	`watch_until` integer NOT NULL,
	`tx_id` text,
	`event_id` text,
	`confirmed_at` integer,
	`review_reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_invoices_order_id_unique` ON `payment_invoices` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_invoices_event_id_unique` ON `payment_invoices` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_amount_never_reused` ON `payment_invoices` (`address`,`amount_units`);--> statement-breakpoint
CREATE INDEX `payment_invoice_status` ON `payment_invoices` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`event_id` text PRIMARY KEY NOT NULL,
	`tx_id` text NOT NULL,
	`address` text NOT NULL,
	`from_hex` text NOT NULL,
	`amount_units` text NOT NULL,
	`block` integer NOT NULL,
	`block_timestamp` integer NOT NULL,
	`invoice_id` text,
	`status` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `payment_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_receipts_created` ON `payment_receipts` (`created_at`);--> statement-breakpoint
CREATE TABLE `payment_watchers` (
	`address` text PRIMARY KEY NOT NULL,
	`address_hex` text NOT NULL,
	`scan_from` integer NOT NULL,
	`window_end` integer,
	`fingerprint` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`last_success_at` integer,
	`last_error` text DEFAULT '' NOT NULL
);
