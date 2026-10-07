import { Skeleton } from "@/components/ui";

export default function PortalLoading() {
  return (
    <div role="status" aria-label="جارٍ التحميل" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-3 rounded-lg border border-line bg-surface p-5">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="space-y-3 rounded-lg border border-line bg-surface p-5">
        <Skeleton className="h-5 w-1/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
