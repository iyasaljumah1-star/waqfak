import { Skeleton } from "@/components/ui";

export default function DocumentsLoading() {
  return (
    <div role="status" aria-label="جارٍ تحميل الوثائق" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-lg" />
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border border-line bg-surface p-5">
              <Skeleton className="h-5 w-1/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </div>
  );
}
