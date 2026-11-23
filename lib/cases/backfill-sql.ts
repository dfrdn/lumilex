import { createHash } from 'crypto';
import type { CasePlan } from './backfill-plan';

/**
 * The SQL that writes a case plan: subjects, cases, proceedings (parents
 * first), which matters handle which proceeding, the matters' links to their
 * cases, related-case links, and each hearing's proceeding. One transaction,
 * with touch_matter_activity skipped — setting a proceeding on every hearing
 * must not restart every matter's 60-day archive clock.
 *
 * Ids are derived from the firm and the plan's keys, so the same plan writes
 * the same rows and running it twice changes nothing. Every row carries the
 * firm, and every hearing it moves is that firm's.
 */
export function backfillSql(plan: CasePlan, firmId: string): string {
  const firm = lit(firmId);
  const lines: string[] = ['BEGIN;', "SET LOCAL lumilex.skip_activity = 'on';"];
  const caseId = new Map(plan.cases.map((c) => [c.key, idFor(`${firmId}:case:${c.key}`)]));

  for (const c of plan.cases) {
    const id = caseId.get(c.key)!;
    lines.push(`INSERT INTO public.subjects (id, firm_id, type) VALUES (${lit(id)}, ${firm}, 'case') ON CONFLICT (id) DO NOTHING;`);
    lines.push(
      `INSERT INTO public.cases (id, firm_id, working_title, nature, status) VALUES (${lit(id)}, ${firm}, ${lit(c.title)}, ${lit(c.nature)}, ${lit(c.status)}) ON CONFLICT (id) DO NOTHING;`,
    );
    const procId = new Map(c.proceedings.map((p) => [p.key, idFor(`${firmId}:proceeding:${p.key}`)]));
    for (const p of c.proceedings) {
      const pid = procId.get(p.key)!;
      const parent = p.parentKey ? procId.get(p.parentKey)! : null;
      lines.push(
        `INSERT INTO public.case_proceedings (id, firm_id, case_id, parent_id, relation, forum_type, court_level, office, docket_no, caption, status, track, stage) VALUES (` +
          [pid, firmId, id, parent, p.relation, p.forum.type, p.forum.level, p.office, p.docket, p.caption, p.resolved ? 'resolved' : 'active', p.track, p.stage]
            .map(lit)
            .join(', ') +
          ') ON CONFLICT (id) DO NOTHING;',
      );
      for (const m of p.matterIds) {
        lines.push(`INSERT INTO public.case_proceeding_matters (firm_id, proceeding_id, matter_id) VALUES (${firm}, ${lit(pid)}, ${lit(m)}) ON CONFLICT DO NOTHING;`);
      }
      if (p.matterIds.length) {
        lines.push(
          `UPDATE public.hearings SET proceeding_id = ${lit(pid)} WHERE firm_id = ${firm} AND matter_id IN (${p.matterIds.map(lit).join(', ')}) AND proceeding_id IS NULL;`,
        );
      }
    }
    for (const m of c.matterIds) {
      lines.push(`INSERT INTO public.matter_subjects (firm_id, subject_id, scope, matter_id) VALUES (${firm}, ${lit(id)}, 'case', ${lit(m)}) ON CONFLICT DO NOTHING;`);
    }
  }

  for (const [a, b] of plan.related) {
    const [x, y] = [caseId.get(a)!, caseId.get(b)!].sort();
    lines.push(`INSERT INTO public.case_links (firm_id, case_id, other_case_id) VALUES (${firm}, ${lit(x)}, ${lit(y)}) ON CONFLICT DO NOTHING;`);
  }

  lines.push('COMMIT;');
  return lines.join('\n') + '\n';
}

/** A stable UUID-shaped id for a plan key. */
export function idFor(key: string): string {
  const h = createHash('sha1').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function lit(v: string | null | undefined): string {
  return v == null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
}
