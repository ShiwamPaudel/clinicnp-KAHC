-- 0028_retired_permissions.sql — take two retired keys out of saved roles.
--
-- Append-only: never edit once applied.
--
-- 0027 retired the counter-side send-out ("lab.sendout") and the lab's
-- Dispatch step ("lab.dispatch"). parsePermissions already ignores keys it
-- does not know, so nothing reads them; this keeps the stored lists clean so
-- the role editor and an exported backup say only what is true.
UPDATE roles
   SET permissions = (SELECT json_group_array(value) FROM json_each(roles.permissions)
                       WHERE value NOT IN ('lab.sendout', 'lab.dispatch'))
 WHERE permissions LIKE '%"lab.sendout"%' OR permissions LIKE '%"lab.dispatch"%';
