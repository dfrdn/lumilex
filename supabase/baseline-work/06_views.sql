create or replace view public.filings as
 SELECT notion_id,
    notion_url,
    name,
    external_due_date AS date,
    matter_id,
    matter_name,
    status,
    currently_with_ids AS attendee_ids,
    NULL::text AS related_deliverable_id
   FROM deliverables
  WHERE type = 'External'::text AND external_due_date IS NOT NULL;

create or replace view public.v_deliverable_version_lookup as
 SELECT df.id AS deliverable_file_id,
    df.deliverable_id,
    df.version,
    df.file_name,
    d.name AS deliverable_name,
    d.matter_id,
    d.matter_name,
    d.type AS deliverable_type
   FROM deliverable_files df
     JOIN deliverables d ON d.notion_id = df.deliverable_id;
