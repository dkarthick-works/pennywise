-- Transaction amounts are non-negative magnitudes. Income is its own section
-- and settlement is its own kind; neither is stored as a negative number.
-- The API already rejects a minus sign; this stops a later write path from
-- storing one.
ALTER TABLE transactions
    ADD CONSTRAINT transactions_amount_nonnegative_chk CHECK (amount >= 0);
