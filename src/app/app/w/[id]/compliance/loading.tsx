import { LoadingBlock, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <LoadingBlock rows={2} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
      </div>
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
    </div>
  );
}
