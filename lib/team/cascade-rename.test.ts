import { describe, it, expect } from 'vitest';
import { cascadeTeamRename } from '@/lib/team/cascade-rename';

function makeClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

const FIRM = '00000000-0000-0000-0000-00000000000a';
const ARGS = { personId: 'person-1', oldName: 'Alex Example', newName: 'Alexandra Example' };

describe('cascadeTeamRename', () => {
  it('does nothing when the name is unchanged or missing', async () => {
    for (const args of [
      { ...ARGS, newName: ARGS.oldName },
      { ...ARGS, oldName: '' },
      { ...ARGS, newName: '' },
    ]) {
      const { client, calls } = makeClient({ data: {}, error: null });
      expect(await cascadeTeamRename(client, FIRM, args)).toEqual({ updated: {}, error: null });
      expect(calls).toHaveLength(0);
    }
  });

  it('hands the firm, the person and both names to the one RPC', async () => {
    const { client, calls } = makeClient({ data: { 'dtr.lawyer_name': 3 }, error: null });
    const res = await cascadeTeamRename(client, FIRM, ARGS);
    expect(calls).toEqual([{
      fn: 'cascade_team_rename',
      args: { p_firm_id: FIRM, p_person_id: 'person-1', p_old_name: 'Alex Example', p_new_name: 'Alexandra Example' },
    }]);
    expect(res).toEqual({ updated: { 'dtr.lawyer_name': 3 }, error: null });
  });

  it('reports a failure instead of throwing', async () => {
    const { client } = makeClient({ data: null, error: { message: 'boom' } });
    expect(await cascadeTeamRename(client, FIRM, ARGS)).toEqual({ updated: {}, error: 'boom' });
  });
});
