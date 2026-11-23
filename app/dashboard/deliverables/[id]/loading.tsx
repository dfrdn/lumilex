import { PageDetailSkeleton } from '@/components/ui/Skeletons';

export default function DetailLoading() {
  return <PageDetailSkeleton actions left={[5, 3, 2]} right={[4, 4]} />;
}
