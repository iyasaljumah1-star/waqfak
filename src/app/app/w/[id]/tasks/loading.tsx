import { LoadingBlock, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <LoadingBlock rows={2} />
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
    </div>
  );
}
