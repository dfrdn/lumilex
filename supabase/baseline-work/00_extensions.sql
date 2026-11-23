-- Extensions present in live origin database, extracted 2026-08-22.
-- plpgsql omitted (default). Schemas are exact as in live pg_extension/pg_namespace.

create extension if not exists "btree_gist" with schema public;
create extension if not exists "citext" with schema public;
create extension if not exists "hypopg" with schema extensions;
create extension if not exists "index_advisor" with schema extensions;
create extension if not exists "pg_cron" with schema pg_catalog;
create extension if not exists "pg_net" with schema extensions;
create extension if not exists "pg_stat_statements" with schema extensions;
create extension if not exists "pg_trgm" with schema public;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "supabase_vault" with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "vector" with schema extensions;
