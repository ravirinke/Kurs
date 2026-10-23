import { TriangleAlert } from "lucide-react";

export function FormError({ message, id }: { message: string; id?: string }) {
  return (
    <p id={id} role="alert" className="text-negative flex items-start gap-2 text-sm">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
