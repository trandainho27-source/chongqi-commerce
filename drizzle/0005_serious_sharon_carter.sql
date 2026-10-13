CREATE TABLE `supplier_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`inventory_id` text NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `supplier_purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_id`) REFERENCES `inventory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_cards_inventory_id_unique` ON `supplier_cards` (`inventory_id`);--> statement-breakpoint
CREATE TABLE `supplier_goods` (
	`product_id` text PRIMARY KEY NOT NULL,
	`goods_id` integer,
	`source_url` text NOT NULL,
	`reference_price` integer NOT NULL,
	`upstream_stock` integer DEFAULT 0 NOT NULL,
	`delivery_type` text DEFAULT 'unknown' NOT NULL,
	`blocked_reason` text DEFAULT '' NOT NULL,
	`synced_at` integer,
	`origin` text DEFAULT 'public' NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_goods_goods_id_unique` ON `supplier_goods` (`goods_id`);--> statement-breakpoint
CREATE TABLE `supplier_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`goods_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`quoted_total` integer NOT NULL,
	`actual_total` integer,
	`status` text DEFAULT 'quoted' NOT NULL,
	`order_sn` text,
	`request_log_id` text DEFAULT '' NOT NULL,
	`encrypted_response` text,
	`error` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_purchases_order_sn_unique` ON `supplier_purchases` (`order_sn`);--> statement-breakpoint
ALTER TABLE `products` ADD `icon_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `country_code` text DEFAULT '' NOT NULL;