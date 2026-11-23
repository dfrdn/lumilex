-- PostgREST caps every request at the authenticator role's 8s statement
-- timeout unless the switched-to role sets its own. A semantic search
-- (match_embeddings over the HNSW index) can take several seconds from a cold
-- cache, and the keyword pass now runs beside it, so a service-role search
-- could be cancelled and come back with only exact matches. Service-role work
-- (search, crons, AI artifact generation) gets 20s; anon and authenticated
-- keep their 3s / 8s.
alter role service_role set statement_timeout = '20s';
notify pgrst, 'reload config';
