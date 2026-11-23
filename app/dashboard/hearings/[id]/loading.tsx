import { PageDetailSkeleton } from '@/components/ui/Skeletons';

export default function DetailLoading() {
  return <PageDetailSkeleton badge="date" left={[1]} right={[3, 5]} />;
}
