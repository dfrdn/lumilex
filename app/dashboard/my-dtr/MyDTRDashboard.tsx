'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Plus } from 'lucide-react';
import type { MyDTREntry } from '@/lib/queries/my-dtr';
import { toDecimal } from '@/lib/dtr-utils';
import AddDTRModal, { type DTRPrefill } from '@/components/AddDTRModal';
import MonthPicker from './MonthPicker';
import SummaryStats from './SummaryStats';
import dynamic from 'next/dynamic';
import type { DayData } from './DailyHoursChart';
import type { TaskData } from './TaskBreakdownChart';
import DTRRecordsTable from './DTRRecordsTable';
import { manilaToday, formatManila } from '@/lib/dates';

function ChartPlaceholder() {
  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-800">
      <div className="h-5 w-28 rounded skeleton-shimmer mb-4" />
      <div className="h-56 sm:h-64 rounded-lg skeleton-shimmer" />
    </div>
  );
}

const DailyHoursChart = dynamic(() => import('./DailyHoursChart'), { ssr: false, loading: ChartPlaceholder });
const TaskBreakdownChart = dynamic(() => import('./TaskBreakdownChart'), { ssr: false, loading: ChartPlaceholder });

interface Props {
  entries: MyDTREntry[];
  month: string;        // "YYYY-MM"
  currentMonth: string; // today's "YYYY-MM"
  lawyerName: string;
}

export default function MyDTRDashboard({ entries: initialEntries, month, currentMonth, lawyerName }: Props) {
  const router = useRouter();
  const [showAddDTR, setShowAddDTR] = useState(false);

  // Lift entries to local state so newly-added rows appear without a refresh.
  const [entries, setEntries] = useState(initialEntries);
  useEffect(() => { setEntries(initialEntries); }, [initialEntries]);

  // After an add: if the entry falls in the month being viewed, append it
  // locally (reactive). Otherwise navigate to its month so it's actually
  // visible — a May entry must not silently vanish from the June view.
  const handleEntryCreated = useCallback((created: MyDTREntry) => {
    setShowAddDTR(false);
    const createdMonth = (created.date ?? '').slice(0, 7);
    if (createdMonth && createdMonth !== month) {
      router.push(`/dashboard/my-dtr?month=${createdMonth}`);
      return;
    }
    setEntries((prev) => [created, ...prev]);
  }, [month, router]);

  const todayStr = manilaToday();

  const defaultPrefill: DTRPrefill = {
    remarks: '',
    task: '',
    date: todayStr,
    hours: 1,
    minutes: 0,
    withIds: [],
    matterId: null,
    matterName: '',
  };

  const { totalHours, workingDays, avgHoursPerDay, dailyData, taskData } = useMemo(() => {
    let total = 0;
    const daysWorked = new Set<string>();
    const taskMap: Record<string, number> = {};
    const dailyMap: Record<string, number> = {};

    for (const e of entries) {
      const dec = toDecimal(e.hours, e.minutes);
      total += dec;
      if (e.date) {
        daysWorked.add(e.date);
        dailyMap[e.date] = (dailyMap[e.date] ?? 0) + dec;
      }
      const taskKey = e.task || 'Unspecified';
      taskMap[taskKey] = (taskMap[taskKey] ?? 0) + dec;
    }

    const wDays = daysWorked.size;
    const avg = wDays > 0 ? total / wDays : 0;

    // Build daily chart data: every day of the month
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const daily: DayData[] = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateStr = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
      return { day, date: dateStr, hours: dailyMap[dateStr] ?? 0 };
    });

    // Task breakdown for donut chart
    const tasks: TaskData[] = Object.entries(taskMap)
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);

    return {
      totalHours: total,
      workingDays: wDays,
      avgHoursPerDay: avg,
      dailyData: daily,
      taskData: tasks,
    };
  }, [entries, month]);

  const monthName = formatManila(new Date(), { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 animate-fade-up">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Clock className="w-5 h-5" />
            My DTR
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Your time record for {monthName}. Every hour logged counts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddDTR(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-gold-600 hover:bg-gold-700 rounded-lg shadow-sm shadow-gold-600/20 transition-all duration-150 active:scale-[0.96] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2"
          >
            <Plus className="w-4 h-4" />
            Add DTR
          </button>
          <MonthPicker month={month} currentMonth={currentMonth} />
        </div>
      </div>

      {/* Summary stats */}
      <SummaryStats
        totalHours={totalHours}
        workingDays={workingDays}
        avgHoursPerDay={avgHoursPerDay}
        entryCount={entries.length}
      />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="hover:shadow-[var(--shadow-card-hover)] transition-shadow duration-200 rounded-xl">
          <DailyHoursChart data={dailyData} />
        </div>
        <div className="hover:shadow-[var(--shadow-card-hover)] transition-shadow duration-200 rounded-xl">
          <TaskBreakdownChart data={taskData} totalHours={totalHours} />
        </div>
      </div>

      {/* Records table */}
      <DTRRecordsTable entries={entries} onEntryCreated={handleEntryCreated} />

      <AddDTRModal
        open={showAddDTR}
        onClose={() => {
          setShowAddDTR(false);
        }}
        prefill={defaultPrefill}
        onSaved={handleEntryCreated}
      />
    </div>
  );
}
