-- 0032_lab_received_at.sql — when the laboratory received a sample, for the report.
--
-- Append-only: never edit once applied.
--
-- The report prints "Sample Received on" (owner, 2083-08-08): the moment the
-- first result for the order was saved in Result entry, draft or submit. Set
-- once and never moved, so a later correction does not change it.
-- Orders from before this column read the first time a result was sent for
-- approval, which is the nearest thing they recorded.

ALTER TABLE lab_orders ADD COLUMN received_at TEXT;

UPDATE lab_orders
   SET received_at = (SELECT MIN(r.submitted_at) FROM lab_results r WHERE r.order_id = lab_orders.id)
 WHERE received_at IS NULL;
