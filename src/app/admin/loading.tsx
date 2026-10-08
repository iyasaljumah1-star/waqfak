import { LoadingBlock } from "@/components/ui";

export default function AdminLoading() {
  return (
    <div className="max-w-5xl">
      <LoadingBlock rows={7} />
    </div>
  );
}
