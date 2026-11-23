/**
 * Philippine Public Holidays (2024–2027)
 *
 * Regular holidays and special non-working days per Philippine law.
 * These are used for business day calculations in court deadline computation.
 *
 * Note: The Philippine President may proclaim additional special holidays via
 * Executive Order. Ad-hoc holidays should be added to the `ph_holidays` DB table.
 */

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  type: 'regular' | 'special_non_working' | 'special_working';
}

// Regular holidays are fixed by law (R.A. 9492, R.A. 9849, etc.)
// Moveable dates (Holy Week, Eid) are set annually by Proclamation

export const PH_HOLIDAYS: Holiday[] = [
  // ── 2024 ──────────────────────────────────────
  { date: '2024-01-01', name: "New Year's Day", type: 'regular' },
  { date: '2024-02-10', name: 'Chinese New Year', type: 'special_non_working' },
  { date: '2024-02-25', name: 'EDSA People Power Revolution Anniversary', type: 'special_non_working' },
  { date: '2024-03-28', name: 'Maundy Thursday', type: 'regular' },
  { date: '2024-03-29', name: 'Good Friday', type: 'regular' },
  { date: '2024-03-30', name: 'Black Saturday', type: 'special_non_working' },
  { date: '2024-04-09', name: 'Araw ng Kagitingan', type: 'regular' },
  { date: '2024-04-10', name: "Eid'l Fitr", type: 'regular' },
  { date: '2024-05-01', name: 'Labor Day', type: 'regular' },
  { date: '2024-06-12', name: 'Independence Day', type: 'regular' },
  { date: '2024-06-17', name: "Eid'l Adha", type: 'regular' },
  { date: '2024-08-21', name: 'Ninoy Aquino Day', type: 'special_non_working' },
  { date: '2024-08-26', name: 'National Heroes Day', type: 'regular' },
  { date: '2024-11-01', name: "All Saints' Day", type: 'special_non_working' },
  { date: '2024-11-02', name: 'All Souls Day', type: 'special_non_working' },
  { date: '2024-11-30', name: 'Bonifacio Day', type: 'regular' },
  { date: '2024-12-08', name: 'Feast of the Immaculate Conception', type: 'special_non_working' },
  { date: '2024-12-24', name: 'Christmas Eve', type: 'special_non_working' },
  { date: '2024-12-25', name: 'Christmas Day', type: 'regular' },
  { date: '2024-12-30', name: 'Rizal Day', type: 'regular' },
  { date: '2024-12-31', name: "New Year's Eve", type: 'special_non_working' },

  // ── 2025 ──────────────────────────────────────
  { date: '2025-01-01', name: "New Year's Day", type: 'regular' },
  { date: '2025-01-29', name: 'Chinese New Year', type: 'special_non_working' },
  { date: '2025-02-25', name: 'EDSA People Power Revolution Anniversary', type: 'special_non_working' },
  { date: '2025-03-31', name: "Eid'l Fitr", type: 'regular' },
  { date: '2025-04-09', name: 'Araw ng Kagitingan', type: 'regular' },
  { date: '2025-04-17', name: 'Maundy Thursday', type: 'regular' },
  { date: '2025-04-18', name: 'Good Friday', type: 'regular' },
  { date: '2025-04-19', name: 'Black Saturday', type: 'special_non_working' },
  { date: '2025-05-01', name: 'Labor Day', type: 'regular' },
  { date: '2025-06-06', name: "Eid'l Adha", type: 'regular' },
  { date: '2025-06-12', name: 'Independence Day', type: 'regular' },
  { date: '2025-08-21', name: 'Ninoy Aquino Day', type: 'special_non_working' },
  { date: '2025-08-25', name: 'National Heroes Day', type: 'regular' },
  { date: '2025-11-01', name: "All Saints' Day", type: 'special_non_working' },
  { date: '2025-11-02', name: 'All Souls Day', type: 'special_non_working' },
  { date: '2025-11-30', name: 'Bonifacio Day', type: 'regular' },
  { date: '2025-12-08', name: 'Feast of the Immaculate Conception', type: 'special_non_working' },
  { date: '2025-12-24', name: 'Christmas Eve', type: 'special_non_working' },
  { date: '2025-12-25', name: 'Christmas Day', type: 'regular' },
  { date: '2025-12-30', name: 'Rizal Day', type: 'regular' },
  { date: '2025-12-31', name: "New Year's Eve", type: 'special_non_working' },

  // ── 2026 ──────────────────────────────────────
  { date: '2026-01-01', name: "New Year's Day", type: 'regular' },
  { date: '2026-02-17', name: 'Chinese New Year', type: 'special_non_working' },
  { date: '2026-02-25', name: 'EDSA People Power Revolution Anniversary', type: 'special_non_working' },
  { date: '2026-03-20', name: "Eid'l Fitr", type: 'regular' },
  { date: '2026-04-02', name: 'Maundy Thursday', type: 'regular' },
  { date: '2026-04-03', name: 'Good Friday', type: 'regular' },
  { date: '2026-04-04', name: 'Black Saturday', type: 'special_non_working' },
  { date: '2026-04-09', name: 'Araw ng Kagitingan', type: 'regular' },
  { date: '2026-05-01', name: 'Labor Day', type: 'regular' },
  { date: '2026-05-27', name: "Eid'l Adha", type: 'regular' },
  { date: '2026-06-12', name: 'Independence Day', type: 'regular' },
  { date: '2026-08-21', name: 'Ninoy Aquino Day', type: 'special_non_working' },
  { date: '2026-08-31', name: 'National Heroes Day', type: 'regular' },
  { date: '2026-11-01', name: "All Saints' Day", type: 'special_non_working' },
  { date: '2026-11-02', name: 'All Souls Day', type: 'special_non_working' },
  { date: '2026-11-30', name: 'Bonifacio Day', type: 'regular' },
  { date: '2026-12-08', name: 'Feast of the Immaculate Conception', type: 'special_non_working' },
  { date: '2026-12-24', name: 'Christmas Eve', type: 'special_non_working' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'regular' },
  { date: '2026-12-30', name: 'Rizal Day', type: 'regular' },
  { date: '2026-12-31', name: "New Year's Eve", type: 'special_non_working' },

  // ── 2027 ──────────────────────────────────────
  { date: '2027-01-01', name: "New Year's Day", type: 'regular' },
  { date: '2027-02-06', name: 'Chinese New Year', type: 'special_non_working' },
  { date: '2027-02-25', name: 'EDSA People Power Revolution Anniversary', type: 'special_non_working' },
  { date: '2027-03-10', name: "Eid'l Fitr", type: 'regular' },
  { date: '2027-03-25', name: 'Maundy Thursday', type: 'regular' },
  { date: '2027-03-26', name: 'Good Friday', type: 'regular' },
  { date: '2027-03-27', name: 'Black Saturday', type: 'special_non_working' },
  { date: '2027-04-09', name: 'Araw ng Kagitingan', type: 'regular' },
  { date: '2027-05-01', name: 'Labor Day', type: 'regular' },
  { date: '2027-05-17', name: "Eid'l Adha", type: 'regular' },
  { date: '2027-06-12', name: 'Independence Day', type: 'regular' },
  { date: '2027-08-21', name: 'Ninoy Aquino Day', type: 'special_non_working' },
  { date: '2027-08-30', name: 'National Heroes Day', type: 'regular' },
  { date: '2027-11-01', name: "All Saints' Day", type: 'special_non_working' },
  { date: '2027-11-02', name: 'All Souls Day', type: 'special_non_working' },
  { date: '2027-11-30', name: 'Bonifacio Day', type: 'regular' },
  { date: '2027-12-08', name: 'Feast of the Immaculate Conception', type: 'special_non_working' },
  { date: '2027-12-24', name: 'Christmas Eve', type: 'special_non_working' },
  { date: '2027-12-25', name: 'Christmas Day', type: 'regular' },
  { date: '2027-12-30', name: 'Rizal Day', type: 'regular' },
  { date: '2027-12-31', name: "New Year's Eve", type: 'special_non_working' },
];

/** Quick lookup set for isHoliday checks */
const HOLIDAY_SET = new Set(
  PH_HOLIDAYS.filter((h) => h.type !== 'special_working').map((h) => h.date),
);

export function isStaticHoliday(date: string): boolean {
  return HOLIDAY_SET.has(date);
}

export function getStaticHolidaysInRange(start: string, end: string): Holiday[] {
  return PH_HOLIDAYS.filter((h) => h.date >= start && h.date <= end && h.type !== 'special_working');
}
