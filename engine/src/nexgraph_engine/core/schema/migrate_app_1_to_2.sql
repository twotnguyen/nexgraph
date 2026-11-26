ALTER TABLE du_an_da_mo ADD COLUMN da_go INTEGER NOT NULL DEFAULT 0 CHECK (da_go IN (0, 1));
PRAGMA user_version = 2;
