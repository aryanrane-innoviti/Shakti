-- Phase 2 follow-up: relax date_of_purchase on the serial-indexed masters
-- to allow NULL. Some uploads (e.g. legacy stock dumps) genuinely don't
-- carry a purchase date, and the spec was relaxed to make it optional.
-- Idempotent: re-running has no effect if the column is already nullable.

ALTER TABLE payment_terminal_master ALTER COLUMN date_of_purchase DROP NOT NULL;
ALTER TABLE base_station_master     ALTER COLUMN date_of_purchase DROP NOT NULL;
