import { describe, expect, it } from 'vitest';
import { pickedRelationId, relationIdFor } from './relation-pick';

const options = [
  { id: 'm-1', name: 'People v. Santos' },
  { id: 'm-2', name: 'People v. Santos' },
  { id: 'm-3', name: 'Acme Retainer' },
];

describe('pickedRelationId', () => {
  it('keeps the picked id when two records share the name', () => {
    expect(pickedRelationId(options, 'People v. Santos', 'm-2')).toBe('m-2');
    expect(pickedRelationId(options, 'People v. Santos', 'm-1')).toBe('m-1');
  });

  it('keeps a picked id the loaded options do not hold yet', () => {
    expect(pickedRelationId([], 'People v. Santos', 'm-2')).toBe('m-2');
  });

  it('falls back to the only option of that name', () => {
    expect(pickedRelationId(options, 'Acme Retainer')).toBe('m-3');
  });

  it('does not guess between records that share the name', () => {
    expect(pickedRelationId(options, 'People v. Santos')).toBeNull();
    expect(pickedRelationId(options, 'People v. Santos', '')).toBeNull();
  });

  it('names nothing when the field is empty', () => {
    expect(pickedRelationId(options, '', 'm-1')).toBeNull();
    expect(pickedRelationId(options, 'Unknown')).toBeNull();
  });
});

describe('relationIdFor', () => {
  it('reads the id sent for a field', () => {
    expect(relationIdFor({ matter_name: 'm-2' }, 'matter_name')).toBe('m-2');
    expect(relationIdFor({ matter_name: ' m-2 ' }, 'matter_name')).toBe('m-2');
  });

  it('gives null for callers that send none', () => {
    expect(relationIdFor(undefined, 'matter_name')).toBeNull();
    expect(relationIdFor({}, 'matter_name')).toBeNull();
    expect(relationIdFor({ matter_name: '' }, 'matter_name')).toBeNull();
    expect(relationIdFor({ matter_name: 42 }, 'matter_name')).toBeNull();
    expect(relationIdFor(['m-2'], 'matter_name')).toBeNull();
  });
});
