import Avatar from '@/components/Avatar';

interface Props {
  initials: string;
  position?: string;
  avatarUrl?: string | null;
  name?: string;
}

export default function PersonBadge({ initials, position, avatarUrl, name }: Props) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs rounded-full pl-0.5 pr-2.5 py-0.5 bg-blue-50 text-blue-700 font-medium ring-1 ring-inset ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20"
      title={position}
    >
      <Avatar
        avatarUrl={avatarUrl}
        initials={initials.charAt(0)}
        name={name}
        size={20}
        fallbackClassName="bg-blue-200 text-blue-800 dark:bg-blue-500/25 dark:text-blue-200 text-[10px] font-bold"
      />
      {initials}
    </span>
  );
}
