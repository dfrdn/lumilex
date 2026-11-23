-- SharePoint/OneDrive archive roots move into firm settings. These name a
-- LIVE archive: a firm's value is set once at provisioning and left alone,
-- because changing it does not move documents already filed under the old
-- name. Blank derives a root from the firm's short name, so a new firm never
-- files into another firm's archive.
--
-- An import of the origin firm must seed its own finance and corporate roots here to keep
-- its existing filed documents reachable.
update public.firms
set settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{documents}',
  jsonb_build_object('financeRoot', '', 'corporateRoot', ''),
  true
)
where not (coalesce(settings, '{}'::jsonb) ? 'documents');
