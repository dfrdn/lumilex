import useSWR from 'swr';
import type { CalendarDeliverable, CalendarLeave, CalendarErrand } from '@/app/api/firm-calendar/month/route';
import type { NotionMeeting, NotionHearing, NotionFiling } from '@/types/notion';
import type { Holiday } from '@/lib/legal/ph-holidays';

export interface FirmCalendarData {
  deliverables: CalendarDeliverable[];
  meetings: NotionMeeting[];
  hearings: NotionHearing[];
  filings: NotionFiling[];
  holidays: Holiday[];
  leaves: CalendarLeave[];
  errands: CalendarErrand[];
}

function pad(n: number) { return n.toString().padStart(2, '0'); }

function getMonthRange(year: number, month: number) {
  const start = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${pad(month)}-${pad(lastDay)}`;
  return { start, end };
}

export function useFirmCalendarMonth(year: number, month: number) {
  const { start, end } = getMonthRange(year, month);
  return useSWR<FirmCalendarData>(
    `/api/firm-calendar/month?start=${start}&end=${end}`,
    { keepPreviousData: true },
  );
}
