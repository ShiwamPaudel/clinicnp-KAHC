/**
 * service-class.ts — which bill service lines are laboratory work, as one SQL
 * fragment, so the dashboard, the day close and anything else that splits the
 * day by kind agree.
 *
 * A line is laboratory work when its service is a lab test or profile (Lab →
 * Tests / Profiles), or when it was sent to an outside laboratory from the
 * counter before 0027 retired that.
 */
export const IS_LAB_LINE = (sl = "sl") => `(${sl}.lab_partner_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM lab_tests lt WHERE lt.service_id = ${sl}.service_id)
  OR EXISTS (SELECT 1 FROM lab_test_groups lg WHERE lg.service_id = ${sl}.service_id))`;
