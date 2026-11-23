import { describe, it, expect } from 'vitest';
import { checkOperatorDeactivation } from './operator-lockout';

const A = 'auth-a';
const B = 'auth-b';

describe('checkOperatorDeactivation', () => {
  it('allows one operator to deactivate another', () => {
    expect(
      checkOperatorDeactivation({
        targetAuthUserId: B,
        actorAuthUserId: A,
        activeAuthUserIds: [A, B],
      }),
    ).toEqual({ ok: true, self: false });
  });

  it('refuses the last active operator, even to someone else', () => {
    const verdict = checkOperatorDeactivation({
      targetAuthUserId: A,
      actorAuthUserId: A,
      activeAuthUserIds: [A],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ code: 'last_operator' });
  });

  it('refuses the last active operator even when the caller confirms', () => {
    const verdict = checkOperatorDeactivation({
      targetAuthUserId: A,
      actorAuthUserId: A,
      activeAuthUserIds: [A],
      confirmSelf: true,
    });
    expect(verdict).toMatchObject({ ok: false, code: 'last_operator' });
  });

  it('refuses unconfirmed self-deactivation while others remain', () => {
    const verdict = checkOperatorDeactivation({
      targetAuthUserId: A,
      actorAuthUserId: A,
      activeAuthUserIds: [A, B],
    });
    expect(verdict).toMatchObject({ ok: false, code: 'self_unconfirmed' });
  });

  it('allows confirmed self-deactivation while others remain', () => {
    expect(
      checkOperatorDeactivation({
        targetAuthUserId: A,
        actorAuthUserId: A,
        activeAuthUserIds: [A, B],
        confirmSelf: true,
      }),
    ).toEqual({ ok: true, self: true });
  });

  it('refuses an operator who is already deactivated', () => {
    const verdict = checkOperatorDeactivation({
      targetAuthUserId: 'auth-gone',
      actorAuthUserId: A,
      activeAuthUserIds: [A, B],
    });
    expect(verdict).toMatchObject({ ok: false, code: 'not_active' });
  });

  it('does not let a deactivated id pad the count', () => {
    // Two rows, one already off: deactivating the survivor is still the last one.
    const verdict = checkOperatorDeactivation({
      targetAuthUserId: A,
      actorAuthUserId: A,
      activeAuthUserIds: [A],
      confirmSelf: true,
    });
    expect(verdict).toMatchObject({ ok: false, code: 'last_operator' });
  });
});
