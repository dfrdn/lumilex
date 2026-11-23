import { PageDetailSkeleton } from '@/components/ui/Skeletons';

export default function DetailLoading() {
  return <PageDetailSkeleton badge="date" left={[1, 7]} right={[3, 5]} />;
}
