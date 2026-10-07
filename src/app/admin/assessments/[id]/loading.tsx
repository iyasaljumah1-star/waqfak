import { LoadingBlock } from "@/components/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6" aria-busy="true" aria-label="نحمّل التقييم">
      <LoadingBlock rows={3} />
      <LoadingBlock rows={6} />
    </div>
  );
}
