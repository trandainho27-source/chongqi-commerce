CREATE INDEX `orders_expiry` ON `orders` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `tickets_order` ON `tickets` (`order_id`,`created_at`);