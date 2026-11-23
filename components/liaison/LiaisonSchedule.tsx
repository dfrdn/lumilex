import { Eye } from 'lucide-react';
import { getAllLiaisonTasks } from '@/lib/queries/liaison';
import PageHeader from '@/components/ui/PageHeader';
import LiaisonScheduleView from './LiaisonScheduleView';

/** The liaison team's errands by day, read-only: the dashboard's page and the liaison shell's both render it. */
export default async function LiaisonSchedule({ firmId }: { firmId: string }) {
  const tasks = await getAllLiaisonTasks(firmId);

  return (
    <>
      <PageHeader
        icon={<Eye className="w-5 h-5" />}
        title="Liaison Schedule"
        subtitle="Who is going where: a read-only view of the liaison team's logistics."
      />
      <LiaisonScheduleView tasks={tasks} />
    </>
  );
}
