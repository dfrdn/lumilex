-- Nothing reads the `filings` view now: Filings is a Deliverables view
-- (type = 'External' with an external_due_date), read from `deliverables`
-- directly, and global_search reads the table since
-- 20261123_retire_filings_view_readers.sql. The view held no data of its own.
-- Apply only once no deployed build still reads it.

DROP VIEW IF EXISTS public.filings;
