import { PageDetailSkeleton } from '@/components/ui/Skeletons';

export default function DetailLoading() {
  return <PageDetailSkeleton left={[5, 3, 3]} right={[6, 4]} comments={false} />;
}
